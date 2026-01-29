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

  const collectionHeaders = ['collection_type', 'relation_type', 'rule_set'];
  const discountHeaders = ['discount_type', 'buy_quantity', 'get_quantity', 'get_discount', 'usage_limit'];
  const metaobjectHeaders = ['metaobject_type', 'definition_type'];

  const collectionHeaderMatches = collectionHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (collectionHeaderMatches >= 2) {
    return {
      isValid: false,
      detectedType: 'collection',
      errorMessage: 'This appears to be a collection file. Please use the Collections import page to import collection data.'
    };
  }

  const discountHeaderMatches = discountHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (discountHeaderMatches >= 3) {
    return {
      isValid: false,
      detectedType: 'discount',
      errorMessage: 'This appears to be a discount file. Please use the Discounts import page to import discount data.'
    };
  }

  const metaobjectHeaderMatches = metaobjectHeaders.filter(h => normalizedHeaders.includes(h)).length;
  if (metaobjectHeaderMatches >= 1) {
    return {
      isValid: false,
      detectedType: 'metaobject',
      errorMessage: 'This appears to be a metaobject file. Please use the Metaobjects import page to import metaobject data.'
    };
  }

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

    const jobId = importJobManager.createJob('companies', records.length);

    (async () => {
      let successCount = 0;
      let errorCount = 0;
      const results: any[] = [];
      const companies: any[] = [];

      records.forEach((record: any, index: number) => {
        const normalizedRecord: any = {};
        Object.keys(record).forEach(key => {
          normalizedRecord[key.toLowerCase().trim()] = record[key];
        });

        const companyId = normalizedRecord.company_id || normalizedRecord.id;
        const name = normalizedRecord.name || normalizedRecord['company name'];

        if (!companyId || !name) {
          errorCount++;
          results.push({
            title: `Row ${index + 1}`,
            status: 'error',
            message: `Missing required fields: ${!companyId ? 'company_id' : ''} ${!name ? 'name' : ''}`.trim()
          });
          return;
        }

        companies.push({
          name: name,
          company_id: companyId,
          main_contact_id: normalizedRecord.main_contact_id || normalizedRecord['company contact last name'] || null,
          contact_email: normalizedRecord.contact_email || normalizedRecord.email || null,
          contact_first_name: normalizedRecord.contact_first_name || normalizedRecord.first_name || null,
          contact_last_name: normalizedRecord.contact_last_name || normalizedRecord.last_name || null,
          contact_phone: normalizedRecord.contact_phone || normalizedRecord.phone || null,
          location_name: normalizedRecord.location_name || normalizedRecord['location name'] || 'Main Location',
          location_id: normalizedRecord.location_id || `${companyId}_LOC${index}`,
          shipping_street: normalizedRecord.shipping_street || normalizedRecord.address1 || normalizedRecord['company location address line 1'] || null,
          shipping_city: normalizedRecord.shipping_city || normalizedRecord.city || normalizedRecord['company location city'] || null,
          shipping_state: normalizedRecord.shipping_state || normalizedRecord.state || normalizedRecord.province || normalizedRecord['company location province'] || null,
          shipping_zip: normalizedRecord.shipping_zip || normalizedRecord.zip || normalizedRecord['company location zip'] || null,
          shipping_country: normalizedRecord.shipping_country || normalizedRecord.country || normalizedRecord.country_code || normalizedRecord['company location country'] || null,
          billing_street: normalizedRecord.billing_street || normalizedRecord.address1 || normalizedRecord['company location address line 1'] || null,
          billing_city: normalizedRecord.billing_city || normalizedRecord.city || normalizedRecord['company location city'] || null,
          billing_state: normalizedRecord.billing_state || normalizedRecord.state || normalizedRecord.province || normalizedRecord['company location province'] || null,
          billing_zip: normalizedRecord.shipping_zip || normalizedRecord.zip || normalizedRecord['company location zip'] || null,
          billing_country: normalizedRecord.shipping_country || normalizedRecord.country || normalizedRecord.country_code || normalizedRecord['company location country'] || null,
          billing_same_as_shipping: normalizedRecord.billing_same_as_shipping !== undefined ? normalizedRecord.billing_same_as_shipping === 'true' || normalizedRecord.billing_same_as_shipping === true : true,
          payment_terms: normalizedRecord.payment_terms || 'Net 30',
          metafields: normalizedRecord.metafields || null,
          catalogs: [],
          shopify_customer_id: undefined
        });
      });

      try {
        const importResults = await importCompanies(companies, admin, 'csv', (current, total) => {
          // Progress update if needed
        });

        const uniqueCompanyIds = new Set(importResults.map((r: any) => r.company_id));
        const companyCount = uniqueCompanyIds.size;

        successCount = importResults.filter((r: any) => r.success).length;
        errorCount = importResults.filter((r: any) => r.success === false).length;

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