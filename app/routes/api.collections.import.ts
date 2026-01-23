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

/**
 * Validates CSV headers to ensure the file matches the expected entity type
 * @param headers Array of header names from the CSV
 * @returns Object with isValid flag and error message if invalid
 */
function validateCollectionHeaders(headers: string[]): { isValid: boolean; errorMessage?: string; detectedType?: string } {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Unique headers that identify specific entity types
  const discountHeaders = ['discount_type', 'buy_quantity', 'get_quantity', 'get_discount', 'usage_limit', 'combines_with_product_discounts'];
  const companyHeaders = ['company_id', 'location_id', 'location_name', 'shipping_street', 'shipping_city', 'contact_email'];
  const metaobjectHeaders = ['metaobject_type', 'definition_type'];

  // Collection-specific headers (at least one should be present)
  const collectionHeaders = ['collection_type', 'relation_type', 'rule_set'];

  // Check if this looks like a discount file
  const discountHeaderMatches = discountHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (discountHeaderMatches >= 3) {
    return {
      isValid: false,
      detectedType: 'discount',
      errorMessage: 'This appears to be a discount file. Please use the Discounts import page to import discount data.'
    };
  }

  // Check if this looks like a company file
  const companyHeaderMatches = companyHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (companyHeaderMatches >= 3) {
    return {
      isValid: false,
      detectedType: 'company',
      errorMessage: 'This appears to be a company file. Please use the Companies import page to import company data.'
    };
  }

  // Check if this looks like a metaobject file
  const metaobjectHeaderMatches = metaobjectHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (metaobjectHeaderMatches >= 1) {
    return {
      isValid: false,
      detectedType: 'metaobject',
      errorMessage: 'This appears to be a metaobject file. Please use the Metaobjects import page to import metaobject data.'
    };
  }

  // Validate that it has at least a title column (required for all collections)
  if (!normalizedHeaders.includes('title')) {
    return {
      isValid: false,
      errorMessage: 'Invalid collection file. The CSV must include a "title" column.'
    };
  }

  return { isValid: true };
}

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

    // Validate CSV headers to ensure correct file type
    if (records.length > 0) {
      const headers = Object.keys(records[0]);
      const validation = validateCollectionHeaders(headers);

      if (!validation.isValid) {
        console.warn(`🚫 Invalid file type detected for collection import:`, validation.detectedType);
        return Response.json({
          error: "Invalid file type",
          message: validation.errorMessage
        }, { status: 400 });
      }
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
              stored_metafields: record.metafields || null
            };

            // Save to database and Shopify
            const result = await saveCollectionLocally(collectionData, admin, { preventUpdate: true });

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

              // Add warnings to the details if present
              if (result.warnings && result.warnings.length > 0) {
                details += ` ⚠️ Warning: ${result.warnings.join('; ')}`;
              }

              results.push({
                title: record.title,
                status: result.warnings && result.warnings.length > 0 ? 'warning' : 'success',
                message: details
              });
            }
          } catch (error) {
            errorCount++;
            const errorMessage = error instanceof Error ? error.message : String(error);

            // Generate user-friendly error messages
            let userFriendlyError = errorMessage;

            // Check for common error patterns and provide helpful guidance
            if (errorMessage.includes('Field definition') && errorMessage.includes('does not exist')) {
              // Metafield error - explain what went wrong
              const collectionTypeLabel = record.collection_type?.toLowerCase() === 'smart' ? 'Smart' : 'Manual';
              userFriendlyError = `Unable to import ${collectionTypeLabel} collection. The metafield format is invalid. Please use the format "namespace.key:value" (e.g., "custom.testfield:myvalue") or remove the metafields column if not needed.`;
            } else if (errorMessage.includes('Title is required')) {
              userFriendlyError = 'Collection title is required. Please ensure each row has a valid title.';
            } else if (errorMessage.includes('Condition is required')) {
              userFriendlyError = `Smart collection requires a condition value. Please provide a value for the rule.`;
            } else if (errorMessage.includes('product IDs')) {
              userFriendlyError = 'Invalid product IDs format. Please use comma-separated numbers (e.g., "123,456,789").';
            } else if (errorMessage.includes('rate limit') || errorMessage.includes('Throttled')) {
              userFriendlyError = 'Shopify rate limit reached. Please try again in a few moments.';
            } else if (errorMessage.includes('Authentication') || errorMessage.includes('permission')) {
              userFriendlyError = 'Authentication error. Please ensure you have the necessary permissions.';
            } else {
              // For other errors, provide a generic but friendly message
              const collectionTypeLabel = record.collection_type?.toLowerCase() === 'smart' ? 'Smart' : 'Manual';
              userFriendlyError = `Failed to import ${collectionTypeLabel} collection: ${errorMessage}`;
            }

            results.push({
              title: record?.title || 'Unknown',
              status: 'error',
              message: userFriendlyError
            });

            // Log technical details for debugging
            console.error(`Failed to import collection "${record?.title}":`, {
              originalError: errorMessage,
              collectionType: record.collection_type,
              field: record.field,
              relationType: record.relation_type,
              hasProducts: !!record.product_ids
            });
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