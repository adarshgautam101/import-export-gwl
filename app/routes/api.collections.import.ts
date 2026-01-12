import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { parse } from "csv-parse";
import { saveCollectionLocally, CollectionType, type SmartCollectionRuleSet, type SmartCollectionCondition } from "../models/Collection.server";
import { ImportExportConfig } from "../config/import-export.config";

const BATCH_SIZE = ImportExportConfig.batchSize;
const DELAY_BETWEEN_BATCHES = ImportExportConfig.delayBetweenBatchesMs;
const CONCURRENCY_LIMIT = 10; // Process this many records concurrently

const isValidImageUrl = (url: string) => {
  if (!url?.trim()) return false;
  try {
    const urlObj = new URL(url);
    // Accept any valid URL that looks like an image
    // Check for common image extensions or just accept all HTTPS/HTTP URLs
    const hasImageExtension = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(urlObj.pathname);
    const isValidProtocol = urlObj.protocol === 'http:' || urlObj.protocol === 'https:';

    // Accept if it has image extension OR if it's a valid HTTP(S) URL
    // (Shopify and CDNs often serve images without extensions in the path)
    return isValidProtocol;
  } catch {
    return false;
  }
};

// Map relation types from CSV to internal format
const mapRelation = (relation: string) => {
  const normalized = relation?.toLowerCase().trim() || '';
  const mapping: Record<string, string> = {
    'equals': 'equals',
    'is_equal_to': 'equals',
    'is equal to': 'equals',
    'not_equals': 'not_equals',
    'is_not_equal_to': 'not_equals',
    'is not equal to': 'not_equals',
    'greater_than': 'greater_than',
    'is_greater_than': 'greater_than',
    'is greater than': 'greater_than',
    'less_than': 'less_than',
    'is_less_than': 'less_than',
    'is less than': 'less_than',
    'starts_with': 'starts_with',
    'ends_with': 'ends_with',
    'contains': 'contains',
    'not_contains': 'not_contains',
    'does_not_contain': 'not_contains',
    'does not contain': 'not_contains',
    'is_empty': 'is_empty',
    'is empty': 'is_empty',
    'is_not_empty': 'is_not_empty',
    'is not empty': 'is_not_empty'
  };
  return mapping[normalized] || 'equals';
};

// Validate and normalize field names
const normalizeField = (field: string) => {
  const normalized = field?.toLowerCase().trim() || '';
  const mapping: Record<string, string> = {
    'tag': 'tag',
    'tags': 'tag',
    'title': 'title',
    'product_title': 'title',
    'type': 'product_type',
    'product_type': 'product_type',
    'category': 'category',
    'vendor': 'vendor',
    'price': 'variant_price',
    'variant_price': 'variant_price',
    'compare_at_price': 'variant_compare_at_price',
    'variant_compare_at_price': 'variant_compare_at_price',
    'weight': 'variant_weight',
    'variant_weight': 'variant_weight',
    'inventory': 'variant_inventory',
    'inventory_stock': 'variant_inventory',
    'variant_inventory': 'variant_inventory',
    'variant_title': 'variant_title'
  };
  return mapping[normalized] || field;
};

import { importJobManager } from "../services/importJobManager.server";

export async function loader({ request }: ActionFunctionArgs) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'Missing jobId' }), { status: 400 });
  }

  const job = importJobManager.getJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404 });
  }

  return new Response(JSON.stringify({
    jobId: job.id,
    status: job.status,
    progress: job.totalRecords > 0 ? Math.round((job.processedRecords / job.totalRecords) * 100) : 0,
    successCount: job.successCount,
    errorCount: job.errorCount,
    results: job.results
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  if (!session || !admin) return Response.json({ error: "Authentication required" }, { status: 401 });

  // Handle cancellation
  if (request.method === 'POST') {
    const contentType = request.headers.get("Content-Type");
    if (contentType && !contentType.includes("application/json")) {
      const clone = request.clone();
      try {
        const formData = await clone.formData();
        const actionType = formData.get('action');
        const jobId = formData.get('jobId');

        if (actionType === 'cancel' && jobId) {
          importJobManager.cancelJob(jobId.toString());
          return new Response(JSON.stringify({ message: 'Import cancelled' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
      } catch (e) {
        // Not a form data request or body already read, proceed to JSON handling
      }
    }
  }

  try {
    // Expecting JSON body with records
    const { records, action } = await request.json();

    if (action !== 'start') {
      throw new Error("Invalid action. Expected 'start'.");
    }

    if (!records || !Array.isArray(records)) {
      return Response.json({ error: "Invalid request body: 'records' array required" }, { status: 400 });
    }

    // Start Background Job
    const jobId = importJobManager.createJob('collections', records.length);

    // Fire and forget processing
    (async () => {
      let successCount = 0;
      let errorCount = 0;
      let processedCount = 0;
      const results: { title: string; status: string; message?: string }[] = [];

      // Process records in parallel with concurrency limit
      const activePromises: Promise<void>[] = [];

      for (const record of records) {
        if (importJobManager.isCancelled(jobId)) {

          break;
        }

        const processRecord = async () => {
          try {
            // Validate required fields
            if (!record.title?.trim()) {
              throw new Error('Title is required');
            }

            const shopify_id = record.shopify_id?.trim() ? BigInt(record.shopify_id) : null;
            const isSmart = record.collection_type?.toLowerCase() === 'smart';

            let rule_set: SmartCollectionRuleSet | null = null;
            let product_ids: string[] = [];

            if (isSmart) {
              // Smart collection - build rule set
              // Priority: 1) New format (field, relation_type, condition), 2) Old format (tags), 3) Fallback

              if (record.field && record.relation_type) {
                // New comprehensive format
                const normalizedField = normalizeField(record.field);
                const normalizedRelation = mapRelation(record.relation_type);

                // Validate condition is provided (unless it's is_empty/is_not_empty)
                if (!record.condition && !['is_empty', 'is_not_empty'].includes(normalizedRelation)) {
                  throw new Error(`Condition is required for ${normalizedField} ${normalizedRelation}`);
                }

                const conditions: SmartCollectionCondition[] = [{
                  field: normalizedField,
                  relation: normalizedRelation,
                  condition: record.condition?.toString().trim() || ''
                }];

                // Use the relation from CSV (ALL or ANY), default to ALL
                const ruleRelation = record.relation?.toString().toUpperCase() === 'ANY' ? 'ANY' : 'ALL';
                rule_set = { relation: ruleRelation, conditions };

              } else if (record.relation_type && record.tags) {
                // Old format (backwards compatibility) - tags only
                const conditions: SmartCollectionCondition[] = [{
                  field: 'tag',
                  relation: mapRelation(record.relation_type),
                  condition: record.tags.toString().trim()
                }];
                rule_set = { relation: 'ALL', conditions };

              } else if (record.tags && !record.relation_type) {
                // Even older format - just tags with equals
                const conditions: SmartCollectionCondition[] = [{
                  field: 'tag',
                  relation: 'equals',
                  condition: record.tags.toString().trim()
                }];
                rule_set = { relation: 'ALL', conditions };

              } else {
                // Fallback - create a default rule
                rule_set = {
                  relation: 'ALL',
                  conditions: [{ field: 'tag', relation: 'equals', condition: 'imported' }]
                };
              }
            } else {
              // Manual collection - extract product IDs
              if (record.product_ids?.trim()) {
                // Handle various formats: "123,456", 123,456, "123","456", etc.
                const cleaned = record.product_ids
                  .toString()
                  .replace(/^["']|["']$/g, '') // Remove outer quotes
                  .replace(/["']/g, ''); // Remove inner quotes

                product_ids = cleaned
                  .split(',')
                  .map((id: string) => id.trim())
                  .filter((id: string) => id && !isNaN(Number(id)));

                if (product_ids.length === 0) {
                  console.warn(`Manual collection "${record.title}" has no valid product IDs`);
                }
              }
            }


            const image_url = isValidImageUrl(record.image_url) ? record.image_url : null;

            // Prepare collection data
            const collectionData = {
              title: record.title.trim(),
              description: record.description?.trim() || null,
              collection_type: isSmart ? CollectionType.smart : CollectionType.manual,
              handle: record.handle?.trim() || null,
              seo_title: record.seo_title?.trim() || null,
              meta_description: record.meta_description?.trim() || null,
              image_url,
              shopify_id,
              rule_set,
              product_ids,
              metafields: record.metafields || null
            };

            // Save to database and Shopify
            const result = await saveCollectionLocally(collectionData, admin);

            successCount++;

            // Log success details for first few records
            if (results.length < 10) {
              const actionLabel = result.action === 'created' ? 'Created' : 'Updated';
              let details = `${actionLabel} ${isSmart ? 'smart' : 'manual'} collection`;
              if (isSmart && rule_set) {
                const rule = rule_set.conditions[0];
                details += ` (${rule.field} ${rule.relation} "${rule.condition}")`;
              } else if (!isSmart && product_ids.length > 0) {
                details += ` (${product_ids.length} products)`;
              }
              results.push({
                title: record.title,
                status: 'success',
                message: details
              });
            }
          } catch (error) {
            errorCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Provide detailed error information
            let detailedError = errorMessage;
            if (record.collection_type?.toLowerCase() === 'smart') {
              detailedError += ` [Smart: ${record.field || 'tag'} ${record.relation_type || 'unknown'}]`;
            } else {
              detailedError += ` [Manual: ${record.product_ids ? 'with products' : 'no products'}]`;
            }

            results.push({
              title: record?.title || 'Unknown',
              status: 'error',
              message: detailedError
            });

            // Log error for debugging
            console.error(`Failed to import collection "${record?.title}":`, errorMessage);
          } finally {
            processedCount++;
            importJobManager.updateProgress(jobId, processedCount, successCount, errorCount, results.slice(results.length - 1));
          }
        };

        const p = processRecord();
        activePromises.push(p);

        p.then(() => activePromises.splice(activePromises.indexOf(p), 1));
        if (activePromises.length >= CONCURRENCY_LIMIT) {
          await Promise.race(activePromises);
        }
      }

      await Promise.all(activePromises);

      if (!importJobManager.isCancelled(jobId)) {
        importJobManager.completeJob(jobId);
      }
    })();

    return Response.json({ jobId, message: 'Import started' });

  } catch (error) {
    console.error('Import failed with exception:', error);
    return Response.json({
      error: "Import failed",
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}