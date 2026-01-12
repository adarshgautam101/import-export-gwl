import { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { stringify } from 'csv-stringify/sync';

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const includeMetafields = false;

  try {
    let allDiscounts: any[] = [];

    // Helper to fetch discounts (Code or Automatic)
    const fetchDiscounts = async (queryName: string, nodeName: string) => {
      let items: any[] = [];
      let hasNextPage = true;
      let endCursor = null;

      const isCodeDiscount = queryName === 'codeDiscountNodes';

      while (hasNextPage) {
        const response: any = await admin.graphql(`
          query Get${queryName}($cursor: String) {
            ${queryName}(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                ${nodeName} {
                  ${isCodeDiscount ? `
                  ... on DiscountCodeBasic {
                    title
                    status
                    startsAt
                    endsAt
                    codes(first: 1) { nodes { code } }
                    customerGets {
                      value {
                        ... on DiscountPercentage { percentage }
                        ... on DiscountAmount { amount { amount currencyCode } }
                      }
                    }
                  }
                  ... on DiscountCodeBxgy {
                    title
                    status
                    startsAt
                    endsAt
                    codes(first: 1) { nodes { code } }
                  }
                  ... on DiscountCodeFreeShipping {
                    title
                    status
                    startsAt
                    endsAt
                    codes(first: 1) { nodes { code } }
                  }
                  ` : `
                  ... on DiscountAutomaticBasic {
                    title
                    status
                    startsAt
                    endsAt
                  }
                  ... on DiscountAutomaticBxgy {
                    title
                    status
                    startsAt
                    endsAt
                  }
                  `}
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
          }
        `, {
          variables: { cursor: endCursor }
        });

        const responseJson: any = await response.json();
        const data: any = responseJson.data || responseJson;

        if (data.errors) {
          console.error(`GraphQL Error fetching ${queryName}:`, data.errors);
          break;
        }

        const nodes = data[queryName]?.nodes || [];
        items = [...items, ...nodes];

        hasNextPage = data[queryName]?.pageInfo?.hasNextPage;
        endCursor = data[queryName]?.pageInfo?.endCursor;
      }
      return items;
    };

    // Fetch Code Discounts
    const codeDiscounts = await fetchDiscounts('codeDiscountNodes', 'codeDiscount');

    // Fetch Automatic Discounts
    const automaticDiscounts = await fetchDiscounts('automaticDiscountNodes', 'automaticDiscount');

    allDiscounts = [...codeDiscounts, ...automaticDiscounts];

    if (!allDiscounts.length) return new Response("No discounts found", { status: 404 });

    const csvData = allDiscounts.map(item => {
      const discount = item.codeDiscount || item.automaticDiscount || {};

      let metafieldsStr = '';
      if (includeMetafields) {
        metafieldsStr = discount.metafields?.edges?.map((edge: any) =>
          `${edge.node.namespace}.${edge.node.key}:${edge.node.value}`
        ).join('|') || '';
      }

      let value = '';
      if (discount.customerGets?.value?.percentage) {
        value = `${discount.customerGets.value.percentage * 100}%`;
      } else if (discount.customerGets?.value?.amount) {
        value = `${discount.customerGets.value.amount.amount} ${discount.customerGets.value.amount.currencyCode}`;
      }

      return {
        title: discount.title || '',
        status: discount.status || '',
        type: item.codeDiscount ? 'Code' : 'Automatic',
        code: discount.codes?.nodes?.[0]?.code || '',
        value: value,
        starts_at: discount.startsAt || '',
        ends_at: discount.endsAt || '',
        ...(includeMetafields ? { metafields: metafieldsStr } : {})
      };
    });

    const columns = ['title', 'status', 'type', 'code', 'value', 'starts_at', 'ends_at'];
    if (includeMetafields) columns.push('metafields');

    const csvContent = stringify(csvData, { header: true, columns });
    const filename = `discounts-export-${new Date().toISOString().split('T')[0]}.csv`;

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });

  } catch (error) {
    console.error("Export error:", error);
    return new Response(
      JSON.stringify({ error: "Failed to export discounts from Shopify" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
