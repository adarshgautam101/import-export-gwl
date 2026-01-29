import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { stringify } from "csv-stringify/sync";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const includeMetafields = true;

  try {
    let allCollections: any[] = [];
    let hasNextPage = true;
    let endCursor = null;

    while (hasNextPage) {
      const response: Response = await admin.graphql(`
        query GetShopifyCollections($cursor: String) {
          collections(first: 250, after: $cursor) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id title handle description descriptionHtml
              productsCount { count }
              image { url altText }
              ruleSet { appliedDisjunctively rules { column relation condition } }
              products(first: 50) { nodes { id } }
              ${includeMetafields ? `
              metafields(first: 20) {
                edges {
                  node {
                    namespace
                    key
                    value
                  }
                }
              }
              ` : ''}
            }
          }
        }
      `, {
        variables: { cursor: endCursor }
      });

      const responseJson: any = await response.json();
      const data: any = responseJson.data || responseJson;

      if (data.errors) throw new Error(`GraphQL Error: ${data.errors.map((e: any) => e.message).join(', ')}`);

      const collections = data.collections?.nodes || [];
      allCollections = [...allCollections, ...collections];

      hasNextPage = data.collections?.pageInfo?.hasNextPage;
      endCursor = data.collections?.pageInfo?.endCursor;
    }

    if (!allCollections.length) return Response.json({ message: "No collections found in Shopify" });

    const csvData = allCollections.map((node: any) => {
      const isSmart = node.ruleSet?.rules?.length > 0;

      // Extract rule details if smart collection
      let field = '';
      let relation_type = '';
      let condition = '';

      if (isSmart && node.ruleSet.rules[0]) {
        const rule = node.ruleSet.rules[0];
        field = rule.column;
        relation_type = rule.relation;
        condition = rule.condition;
      }

      // Extract product IDs for manual collections
      const productIds = node.products?.nodes?.map((p: any) => p.id.split('/').pop()).join(',') || '';

      const baseData = {
        title: node.title || '',
        description: node.description || node.descriptionHtml || '',
        handle: node.handle || '',
        collection_type: isSmart ? 'smart' : 'manual',
        field: field,
        relation_type: relation_type || (isSmart ? (node.ruleSet.appliedDisjunctively ? 'ANY' : 'ALL') : ''),
        condition: condition,
        tags: '', // Deprecated/Legacy
        product_ids: productIds,
        products_count: node.productsCount?.count || 0,
        image_url: node.image?.url || ''
      };

      if (includeMetafields) {
        const metafields = node.metafields?.edges?.map((edge: any) =>
          `${edge.node.namespace}.${edge.node.key}:${edge.node.value}`
        ).join('|') || '';
        return { ...baseData, metafields };
      }

      return baseData;
    });

    const columns = ['title', 'description', 'handle', 'collection_type', 'field', 'relation_type', 'condition', 'tags', 'product_ids', 'products_count', 'image_url'];
    if (includeMetafields) columns.push('metafields');

    const csvString = stringify(csvData, {
      header: true,
      columns: columns
    });

    return new Response(csvString, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="shopify-collections-export-${Date.now()}.csv"`,
      },
    });

  } catch (error) {
    console.error("Export failed:", error);
    return Response.json({ error: "Export failed", message: (error as Error).message }, { status: 500 });
  }
}