// app/routes/api.discounts.import.tsx
import { ActionFunction, ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { createDiscount, createDiscountInShopify, verifyAppPermissions } from "../models/Discount.server";
import { importJobManager } from "../services/importJobManager.server";

interface CsvRecord {
  title: string;
  description?: string;
  discount_type: string;
  value?: string;
  code?: string;
  buy_quantity?: string;
  get_quantity?: string;
  get_discount?: string;
  applies_to?: string;
  customer_eligibility?: string;
  minimum_requirement_type?: string;
  minimum_requirement_value?: string;
  usage_limit?: string;
  one_per_customer?: string;
  combines_with_product_discounts?: string;
  combines_with_order_discounts?: string;
  combines_with_shipping_discounts?: string;
  starts_at?: string;
  ends_at?: string;
  product_ids?: string;
  collection_ids?: string;
}

/**
 * Validates CSV headers to ensure the file matches the expected entity type
 * @param headers Array of header names from the CSV
 * @returns Object with isValid flag and error message if invalid
 */
function validateDiscountHeaders(headers: string[]): { isValid: boolean; errorMessage?: string; detectedType?: string } {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Unique headers that identify specific entity types
  const collectionHeaders = ['collection_type', 'relation_type', 'rule_set'];
  const companyHeaders = ['company_id', 'location_id', 'location_name', 'shipping_street', 'shipping_city'];
  const metaobjectHeaders = ['metaobject_type', 'definition_type'];

  // Check if this looks like a collection file
  const collectionHeaderMatches = collectionHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (collectionHeaderMatches >= 2) {
    return {
      isValid: false,
      detectedType: 'collection',
      errorMessage: 'This appears to be a collection file. Please use the Collections import page to import collection data.'
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

  // Validate that it has discount-specific columns
  if (!normalizedHeaders.includes('discount_type') && !normalizedHeaders.includes('title')) {
    return {
      isValid: false,
      errorMessage: 'Invalid discount file. The CSV must include a "title" and "discount_type" column.'
    };
  }

  return { isValid: true };
}

// Safe date parsing function
const parseDate = (dateString: string | undefined): Date | undefined => {
  if (!dateString) return undefined;
  try {
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? undefined : date;
  } catch {
    return undefined;
  }
};

// Helper function to parse CSV with robust handling of quotes
function parseCSVWithFlexibleColumns(csvText: string, delimiter: string = ','): CsvRecord[] {


  // Clean the CSV text
  let cleanCsvText = csvText;

  // Remove UTF-8 BOM if present
  if (cleanCsvText.charCodeAt(0) === 0xFEFF) {
    cleanCsvText = cleanCsvText.substring(1);

  }

  // Remove any quotes that wrap the entire content
  cleanCsvText = cleanCsvText.trim();
  if (cleanCsvText.startsWith('"') && cleanCsvText.endsWith('"')) {
    cleanCsvText = cleanCsvText.substring(1, cleanCsvText.length - 1);

  }



  // Split into lines
  const lines = cleanCsvText.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');



  if (lines.length < 2) {
    console.error('Not enough lines in CSV');
    return [];
  }

  // Function to parse a CSV line properly handling quotes
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote inside quotes
          currentField += '"';
          i++; // Skip next character
        } else {
          // Start or end quotes
          inQuotes = !inQuotes;
        }
      } else if (char === delimiter && !inQuotes) {
        // End of field
        result.push(currentField);
        currentField = '';
      } else {
        currentField += char;
      }
    }

    // Add the last field
    result.push(currentField);

    // Trim and clean each field
    return result.map(field => {
      field = field.trim();
      // Remove surrounding quotes if present
      if (field.startsWith('"') && field.endsWith('"')) {
        field = field.substring(1, field.length - 1);
      }
      return field;
    });
  };

  // Parse headers
  const headers = parseCSVLine(lines[0]);


  const records: CsvRecord[] = [];

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);


    // Ensure we have enough values (pad if needed)
    const paddedValues = [...values];
    while (paddedValues.length < headers.length) {
      paddedValues.push('');
    }

    // Create record object
    const record: any = {};
    headers.forEach((header, index) => {
      // Clean header name
      const cleanHeader = header.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
      record[cleanHeader] = paddedValues[index] || '';
    });



    // Map to CsvRecord interface
    const mappedRecord: CsvRecord = {
      title: record.title || record.discount_title || '',
      description: record.description || '',
      discount_type: record.discount_type || record.type || '',
      value: record.value || '',
      code: record.code || record.discount_code || '',
      buy_quantity: record.buy_quantity || record.buy_qty || '',
      get_quantity: record.get_quantity || record.get_qty || '',
      get_discount: record.get_discount || '',
      applies_to: record.applies_to || '',
      customer_eligibility: record.customer_eligibility || '',
      minimum_requirement_type: record.minimum_requirement_type || '',
      minimum_requirement_value: record.minimum_requirement_value || '',
      usage_limit: record.usage_limit || '',
      one_per_customer: record.one_per_customer || '',
      combines_with_product_discounts: record.combines_with_product_discounts || '',
      combines_with_order_discounts: record.combines_with_order_discounts || '',
      combines_with_shipping_discounts: record.combines_with_shipping_discounts || '',
      starts_at: record.starts_at || '',
      ends_at: record.ends_at || '',
      product_ids: record.product_ids || '',
      collection_ids: record.collection_ids || '',
    };

    records.push(mappedRecord);
  }

  return records;
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

export const action: ActionFunction = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  // Handle cancellation
  if (request.method === 'POST') {
    const contentType = request.headers.get("Content-Type");

    // Check for cancellation request (FormData)
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

  // Handle Start Import (POST)
  try {
    let records: CsvRecord[] = [];
    const contentType = request.headers.get("Content-Type");

    if (contentType && contentType.includes("application/json")) {
      const body = await request.json();
      if (body.action === 'start' && body.records && Array.isArray(body.records)) {
        records = body.records;
      } else {
        throw new Error("Invalid JSON payload: 'records' array is missing or action is not 'start'");
      }
    } else {
      throw new Error("Content-Type must be application/json");
    }

    // Validate CSV structure
    if (!records || records.length === 0) {
      throw new Error("CSV file is empty or has no valid data.");
    }

    // Validate CSV headers to ensure correct file type
    const headers = Object.keys(records[0]);
    const validation = validateDiscountHeaders(headers);

    if (!validation.isValid) {
      console.warn(`🚫 Invalid file type detected for discount import:`, validation.detectedType);
      throw new Error(validation.errorMessage || 'Invalid file type');
    }


    // Start Background Job
    const jobId = importJobManager.createJob('discounts', records.length);

    // Fire and forget processing
    (async () => {
      let successCount = 0;
      let errorCount = 0;
      let processedCount = 0;
      const results: any[] = [];

      try {
        // Verify app permissions first
        const permissionsOk = await verifyAppPermissions(admin);
        if (!permissionsOk) {
          throw new Error("App permissions issue.");
        }

        for (const [index, record] of records.entries()) {
          // Check for cancellation
          if (importJobManager.isCancelled(jobId)) {

            break;
          }

          processedCount++;

          try {
            // Transform CSV data
            const discountData = {
              title: record.title.trim(),
              description: record.description?.trim() || undefined,
              discount_type: record.discount_type.trim().toLowerCase() as 'percentage' | 'fixed_amount' | 'shipping' | 'buy_x_get_y',
              value: record.value && record.value.trim() !== '' ? parseFloat(record.value) : undefined,
              code: record.code?.trim() || undefined,

              // Buy X Get Y fields
              buy_quantity: record.buy_quantity && record.buy_quantity.trim() !== '' ? parseInt(record.buy_quantity) : undefined,
              get_quantity: record.get_quantity && record.get_quantity.trim() !== '' ? parseInt(record.get_quantity) : undefined,
              get_discount: record.get_discount && record.get_discount.trim() !== '' ? parseFloat(record.get_discount) : undefined,

              // Eligibility
              applies_to: (record.applies_to?.trim().toLowerCase() as 'all' | 'specific_products' | 'specific_collections') || 'all',
              customer_eligibility: (record.customer_eligibility?.trim().toLowerCase() as 'all' | 'specific_segments' | 'specific_customers') || 'all',
              minimum_requirement_type: (record.minimum_requirement_type?.trim().toLowerCase() as 'none' | 'subtotal' | 'quantity') || 'none',
              minimum_requirement_value: record.minimum_requirement_value && record.minimum_requirement_value.trim() !== '' ? parseFloat(record.minimum_requirement_value) : undefined,

              // Usage
              usage_limit: record.usage_limit && record.usage_limit.trim() !== '' ? parseInt(record.usage_limit) : undefined,
              one_per_customer: record.one_per_customer?.toLowerCase() === 'true',

              // Combinations
              combines_with_product_discounts: record.combines_with_product_discounts?.toLowerCase() === 'true',
              combines_with_order_discounts: record.combines_with_order_discounts?.toLowerCase() === 'true',
              combines_with_shipping_discounts: record.combines_with_shipping_discounts?.toLowerCase() === 'true',

              // Dates - use safe parsing
              starts_at: parseDate(record.starts_at) || new Date(),
              ends_at: parseDate(record.ends_at),

              // Products/Collections
              product_ids: record.product_ids ? record.product_ids.split(',').map((id: string) => id.trim()).filter(Boolean) : [],
              collection_ids: record.collection_ids ? record.collection_ids.split(',').map((id: string) => id.trim()).filter(Boolean) : []
            };

            // Validate required fields for specific discount types
            if (discountData.discount_type === 'percentage' && !discountData.value) {
              throw new Error("Percentage discounts require a 'value' field");
            }

            if (discountData.discount_type === 'fixed_amount' && !discountData.value) {
              throw new Error("Fixed amount discounts require a 'value' field");
            }

            if (discountData.discount_type === 'shipping') {
              discountData.value = 0;
            }

            // Validate Buy X Get Y discounts
            if (discountData.discount_type === 'buy_x_get_y') {
              if (!discountData.buy_quantity || !discountData.get_quantity) {
                throw new Error("Buy X Get Y discounts require 'buy_quantity' and 'get_quantity' fields");
              }
              if (!discountData.get_discount) {
                discountData.get_discount = 100; // Default to free
              }
            }

            // Create in Shopify
            const shopifyDiscount = await createDiscountInShopify(admin, discountData);

            if (!shopifyDiscount?.id) {
              throw new Error('Failed to create discount in Shopify - no ID returned');
            }

            // Save locally with Shopify ID and the ACTUAL code used in Shopify
            await createDiscount(admin, {
              ...discountData,
              code: shopifyDiscount.code, // Use the code returned from Shopify (which might have a suffix)
              shopify_id: shopifyDiscount.id,
              status: 'active'
            });

            successCount++;
            results.push({
              title: record.title,
              status: 'success',
              message: 'Discount created successfully',
              shopifyId: shopifyDiscount.id
            });

          } catch (error: any) {
            errorCount++;
            results.push({
              title: record.title,
              status: 'error',
              message: error.message
            });
          }

          // Update progress every record (or batch if needed)
          importJobManager.updateProgress(jobId, processedCount, successCount, errorCount, results.slice(results.length - 1));
        }

        if (!importJobManager.isCancelled(jobId)) {
          importJobManager.completeJob(jobId);
        }

      } catch (error: any) {
        console.error('Background job failed:', error);
        importJobManager.failJob(jobId, error.message);
      }
    })();

    return new Response(JSON.stringify({ jobId, message: 'Import started' }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }
};