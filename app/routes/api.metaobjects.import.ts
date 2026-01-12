import { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { parse } from "csv-parse";
import { getMetaobjectDefinitionByType, parseValue } from "../models/metaobject.server";

const BATCH_SIZE = 5;
const DELAY_BETWEEN_BATCHES = 1000;

import { importJobManager } from "../services/importJobManager.server";

export async function loader({ request }: ActionFunctionArgs) {
    const url = new URL(request.url);
    const jobId = url.searchParams.get('jobId');

    if (jobId) {
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

    return Response.json({ message: "This endpoint only accepts POST requests for CSV import." }, { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
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
        // Handle JSON payload from useImport hook
        let records: any[] = [];
        let type = "";

        const contentType = request.headers.get("Content-Type");
        if (contentType && contentType.includes("application/json")) {
            const body = await request.json();
            if (body.action === 'start') {
                records = body.records;
                // For metaobjects, we need the type. It might be in the first record or passed separately.
                // The current useImport hook doesn't pass 'type' in the body for generic imports,
                // but for metaobjects the CSV usually implies the type or it's selected in UI.
                // However, the previous implementation expected 'type' in FormData.
                // We need to check how the client sends 'type'.
                // Looking at the previous implementation: const type = formData.get("type") as string;

                // If the client hook doesn't support sending extra data, we might need to rely on the URL or 
                // assume the type is passed in the body if we modified the client.
                // Since we didn't modify the client to send 'type' in the JSON body explicitly for metaobjects,
                // we might have a problem here if 'type' is required.

                // Let's assume for now that we can get 'type' from the URL query params if it was passed there,
                // or we need to update the client to send it.
                // BUT, looking at the previous code, it was `formData.get("type")`.
                // The `useImport` hook we wrote sends `JSON.stringify({ action: 'start', records })`.
                // It does NOT send `type`.

                // CRITICAL FIX: We need to get 'type'. 
                // If the user is on a metaobject page, the entityType passed to useImport might be "metaobjects/definitions/some_type".
                // But the `useImport` hook takes `url` and `entityType`.
                // The `url` is likely `/api/metaobjects/import?type=some_type` if we set it up that way.
                // Let's check if 'type' is in the URL search params.
                const url = new URL(request.url);
                type = url.searchParams.get("type") || "";

                // If not in URL, check if it's in the body (in case we update client later)
                if (!type && body.type) type = body.type;
            }
        } else {
            // Fallback to FormData if not JSON (though we want to move to JSON)
            // But we are standardizing on JSON.
            throw new Error("Content-Type must be application/json");
        }

        if (!records || !Array.isArray(records)) {
            return Response.json({ error: "Invalid request body: 'records' array required" }, { status: 400 });
        }

        if (!type) {
            // If type is still missing, we can't proceed.
            return Response.json({ error: "Metaobject type is required. Please ensure it is passed in the URL query parameter 'type'." }, { status: 400 });
        }

        // 1. Fetch Definition
        const definition = await getMetaobjectDefinitionByType(admin, type);
        if (!definition) {
            return Response.json({ error: "Metaobject definition not found" }, { status: 404 });
        }

        // Start Background Job
        const jobId = importJobManager.createJob(`metaobjects:${type}`, records.length);

        // Fire and forget processing
        (async () => {
            let successCount = 0;
            let errorCount = 0;
            let processedCount = 0;
            const results: { title: string; status: string; message?: string }[] = [];

            // Process Records
            for (let i = 0; i < records.length; i += BATCH_SIZE) {
                if (importJobManager.isCancelled(jobId)) {

                    break;
                }

                const batch = records.slice(i, i + BATCH_SIZE);

                const batchResults = await Promise.allSettled(batch.map(async (record, index) => {
                    const handle = record.handle;

                    try {
                        // Map fields
                        const fields = [];

                        for (const fieldDef of definition.fieldDefinitions) {
                            const rawValue = record[fieldDef.key];
                            if (rawValue !== undefined && rawValue !== '') {
                                const parsedValue = await parseValue(admin, rawValue, fieldDef.type.name);
                                if (parsedValue !== null) {
                                    fields.push({ key: fieldDef.key, value: parsedValue });
                                }
                            }
                        }

                        if (fields.length === 0) {
                            throw new Error("No valid fields found to import");
                        }

                        // Upsert or Create
                        let mutation = "";
                        let variables: any = {};

                        if (handle) {
                            mutation = `
                  mutation UpsertMetaobject($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
                    metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
                      metaobject { handle }
                      userErrors { field message }
                    }
                  }
                `;
                            variables = {
                                handle: { type, handle },
                                metaobject: {
                                    fields
                                }
                            };
                        } else {
                            mutation = `
                  mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
                    metaobjectCreate(metaobject: $metaobject) {
                      metaobject { handle }
                      userErrors { field message }
                    }
                  }
                `;
                            variables = {
                                metaobject: {
                                    type,
                                    fields,
                                    status: record.status?.toUpperCase() === 'DRAFT' ? 'DRAFT' : 'ACTIVE'
                                }
                            };
                        }

                        const response = await admin.graphql(mutation, { variables });
                        const json = await response.json();

                        const data = handle ? json.data.metaobjectUpsert : json.data.metaobjectCreate;

                        if (data.userErrors?.length > 0) {
                            throw new Error(data.userErrors.map((e: any) => `${e.field}: ${e.message}`).join(', '));
                        }

                        successCount++;
                        return {
                            title: data.metaobject?.handle || handle || `Row ${i + index + 1}`,
                            status: 'success',
                            message: 'Imported successfully'
                        };

                    } catch (error) {
                        console.error(`Failed to import row ${i + index + 1} (${handle}):`, (error as Error).message);
                        errorCount++;
                        return {
                            title: handle || `Row ${i + index + 1}`,
                            status: 'error',
                            message: (error as Error).message
                        };
                    }
                }));

                batchResults.forEach(result => {
                    if (result.status === 'fulfilled') {
                        results.push(result.value);
                    }
                });

                processedCount += batch.length;
                importJobManager.updateProgress(jobId, processedCount, successCount, errorCount, results.slice(results.length - batch.length));

                if (i + BATCH_SIZE < records.length) await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
            }

            if (!importJobManager.isCancelled(jobId)) {
                importJobManager.completeJob(jobId);
            }

        })();

        return Response.json({ jobId, message: 'Import started' });

    } catch (error) {
        console.error("Import failed:", error);
        return Response.json({ error: "Import failed", message: (error as Error).message }, { status: 500 });
    }
}
