// app/routes/api.companies.import.ts
import { ActionFunctionArgs } from "react-router";
import { importCompanies } from "../models/company.server";
import { authenticate } from "../shopify.server";

import { importJobManager } from "../services/importJobManager.server";

/**
 * Validates CSV headers to ensure the file matches the expected entity type
 * @param headers Array of header names from the CSV
 * @returns Object with isValid flag and error message if invalid
 */
function validateCompanyHeaders(headers: string[]): { isValid: boolean; errorMessage?: string; detectedType?: string } {
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim());

  // Unique headers that identify specific entity types
  const collectionHeaders = ['collection_type', 'relation_type', 'rule_set'];
  const discountHeaders = ['discount_type', 'buy_quantity', 'get_quantity', 'get_discount', 'usage_limit'];
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

  // Check if this looks like a discount file
  const discountHeaderMatches = discountHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (discountHeaderMatches >= 3) {
    return {
      isValid: false,
      detectedType: 'discount',
      errorMessage: 'This appears to be a discount file. Please use the Discounts import page to import discount data.'
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

  // Validate that it has company-specific columns
  if (!normalizedHeaders.includes('company_id') && !normalizedHeaders.includes('name')) {
    return {
      isValid: false,
      errorMessage: 'Invalid company file. The CSV must include either "company_id" or "name" column.'
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
    companyCount: job.companyCount,
    results: job.results
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const { admin } = await authenticate.admin(request);

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
      const validation = validateCompanyHeaders(headers);

      if (!validation.isValid) {
        console.warn(`🚫 Invalid file type detected for company import:`, validation.detectedType);
        return Response.json({
          error: "Invalid file type",
          message: validation.errorMessage
        }, { status: 400 });
      }
    }


    // Start Background Job
    const jobId = importJobManager.createJob('companies', records.length);

    // Fire and forget processing
    (async () => {
      let successCount = 0;
      let errorCount = 0;
      let processedCount = 0;
      const results: any[] = [];

      // Transform CSV records to company format
      const companies = records.map((record: any, index: number) => ({
        name: record.name || record['Company Name'] || `Company ${index + 1}`,
        company_id: record.company_id || record.id || `COMP_${Date.now()}_${index}`,
        main_contact_id: record.main_contact_id || record['Company Contact Last Name'] || null,
        contact_email: record.contact_email || null,
        contact_first_name: record.contact_first_name || null,
        contact_last_name: record.contact_last_name || null,
        contact_phone: record.contact_phone || null,
        location_name: record.location_name || 'Main Location',
        location_id: record.location_id || `${record.company_id || index}_LOC0`,
        shipping_street: record.shipping_street || record['Company Location Address Line 1'] || null,
        shipping_city: record.shipping_city || record['Company Location City'] || null,
        shipping_state: record.shipping_state || record['Company Location Province'] || null,
        shipping_zip: record.shipping_zip || record['Company Location Zip'] || null,
        shipping_country: record.shipping_country || record['Company Location Country'] || null,
        billing_street: record.billing_street || record['Company Location Address Line 1'] || null,
        billing_city: record.billing_city || record['Company Location City'] || null,
        billing_state: record.billing_state || record['Company Location Province'] || null,
        billing_zip: record.billing_zip || record['Company Location Zip'] || null,
        billing_country: record.billing_country || record['Company Location Country'] || null,
        billing_same_as_shipping: record.billing_same_as_shipping !== undefined ? record.billing_same_as_shipping === 'true' || record.billing_same_as_shipping === true : true,
        payment_terms: record.payment_terms || 'Net 30',
        metafields: record.metafields || null,
        catalogs: [],
        shopify_customer_id: undefined
      }));

      // Process ALL companies together (importCompanies handles grouping by company_id internally)
      try {
        console.log(`🏢 Starting import of ${companies.length} location records...`);

        const importResults = await importCompanies(companies, admin, 'csv', (current, total) => {
          const progress = Math.round((current / total) * 100);
          console.log(`Progress: ${current}/${total} companies processed (${progress}%)`);
        });

        console.log(`✅ Import completed. Processing ${importResults.length} results...`);

        // Count unique companies vs total locations
        const uniqueCompanyIds = new Set(importResults.map((r: any) => r.company_id));
        const companyCount = uniqueCompanyIds.size;

        successCount = importResults.filter((r: any) => r.success).length;
        errorCount = importResults.filter((r: any) => r.success === false).length;

        console.log(`📊 Summary: ${companyCount} companies, ${successCount} locations created/updated, ${errorCount} errors`);

        // Build results for UI
        importResults.forEach((result: any) => {
          if (!result.success) {
            results.push({
              title: `${result.company_id} - ${result.location_name || result.location_id}`,
              status: 'error',
              message: result.message || result.error || 'Unknown error'
            });
          }
        });

        importJobManager.updateProgress(jobId, companyCount, successCount, errorCount, results, companyCount);
        importJobManager.completeJob(jobId);

      } catch (error: any) {
        console.error('❌ Import failed:', error);
        importJobManager.failJob(jobId, error.message);
      }
    })();

    return Response.json({ jobId, message: 'Import started' });

  } catch (error: any) {
    console.error("❌ Import error:", error);
    return Response.json({
      error: "Import failed",
      message: error instanceof Error ? error.message : "Failed to import companies"
    }, { status: 500 });
  }
}