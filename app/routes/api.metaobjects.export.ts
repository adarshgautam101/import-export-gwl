import { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { stringify } from "csv-stringify/sync";
import { getMetaobjectDefinitionByType } from "../models/metaobject.server";

export async function loader({ request }: LoaderFunctionArgs) {

    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const type = url.searchParams.get("type");


    if (!type) {
        console.error("Missing type parameter");
        return Response.json({ error: "Missing 'type' parameter" }, { status: 400 });
    }

    try {
        // 1. Fetch Definition to get headers
        const definition = await getMetaobjectDefinitionByType(admin, type);
        if (!definition) {
            console.error("Metaobject definition not found");
            return Response.json({ error: "Metaobject definition not found" }, { status: 404 });
        }


        const fieldKeys = definition.fieldDefinitions.map(f => f.key);
        // System fields + Dynamic fields
        const columns = ['handle', ...fieldKeys, 'status']; // 'status' is often useful (active/draft)

        // 2. Fetch Entries
        let allEntries: any[] = [];
        let hasNextPage = true;
        let endCursor = null;

        while (hasNextPage) {

            const response: Response = await admin.graphql(`
        query GetMetaobjects($type: String!, $cursor: String) {
          metaobjects(type: $type, first: 250, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              handle
              updatedAt
              fields {
                key
                value
                jsonValue
              }
            }
          }
        }
      `, {
                variables: { type, cursor: endCursor }
            });

            const json: any = await response.json();
            const data: any = json.data.metaobjects;

            allEntries = [...allEntries, ...data.nodes];
            hasNextPage = data.pageInfo.hasNextPage;
            endCursor = data.pageInfo.endCursor;
        }


        // 3. Map to CSV
        const csvData = allEntries.map(entry => {
            const row: Record<string, string> = {
                handle: entry.handle,
                status: 'active', // Defaulting to active as status isn't always directly exposed or needed for simple import
            };

            // Map dynamic fields
            definition.fieldDefinitions.forEach(fieldDef => {
                const field = entry.fields.find((f: any) => f.key === fieldDef.key);
                if (field) {
                    // Use value (string representation) or jsonValue if needed.
                    // For most types, 'value' is what we want (it's the stringified version).
                    // For lists, 'value' is a JSON array string.
                    // For references, 'value' is the GID.
                    row[fieldDef.key] = field.value || '';
                } else {
                    row[fieldDef.key] = '';
                }
            });

            return row;
        });

        const csvString = stringify(csvData, {
            header: true,
            columns: columns
        });


        return Response.json({
            csvData: csvString,
            filename: `${type}-export-${Date.now()}.csv`
        });

    } catch (error) {
        console.error("Export failed:", error);
        return Response.json({ error: "Export failed", message: (error as Error).message }, { status: 500 });
    }
}
