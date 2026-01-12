import { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { stringify } from 'csv-stringify/sync';
import { exportCompanies } from "../models/company.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const includeMetafields = true;

  try {
    // First, try to get companies from Shopify API
    let allCompanies: any[] = [];
    let hasNextPage = true;
    let endCursor = null;

    try {
      while (hasNextPage) {
        const response: Response = await admin.graphql(`
          query GetShopifyCompanies($cursor: String) {
            companies(first: 50, after: $cursor) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                name
                externalId
                locations(first: 10) {
                  nodes {
                    id
                    name
                    shippingAddress {
                      address1
                      city
                      zoneCode
                      zip
                      countryCode
                    }
                  }
                }
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

        if (data.errors) {
          console.warn("GraphQL Warning:", data.errors);
          const companiesPermissionError = data.errors.some((e: any) =>
            e.message?.includes("companies") || e.message?.includes("permission")
          );
          if (companiesPermissionError) {
            console.warn("Companies permission error, falling back to local database");
            break;
          }
        }

        const companies = data.companies?.nodes || [];
        allCompanies = [...allCompanies, ...companies];

        hasNextPage = data.companies?.pageInfo?.hasNextPage;
        endCursor = data.companies?.pageInfo?.endCursor;
      }
    } catch (graphqlError) {
      console.warn("GraphQL query failed, falling back to local database:", graphqlError);
    }

    // If no companies from Shopify, fall back to local database
    if (!allCompanies.length) {

      const localCompanies = await exportCompanies();

      // Group local companies by company_id
      const groupedCompanies = new Map<string, any>();

      for (const company of localCompanies) {
        const companyId = company.company_id || `local_${company.id}`;
        if (!groupedCompanies.has(companyId)) {
          groupedCompanies.set(companyId, {
            name: company.name,
            externalId: company.company_id,
            locations: [],
            metafields: company.metafields
          });
        }

        const companyGroup = groupedCompanies.get(companyId);
        companyGroup.locations.push({
          id: company.location_id || '',
          name: company.location_name || company.name,
          shippingAddress: {
            address1: company.shipping_street || '',
            city: company.shipping_city || '',
            zoneCode: company.shipping_state || '',
            zip: company.shipping_zip || '',
            countryCode: company.shipping_country || 'US'
          }
        });
      }

      // Convert to array format
      allCompanies = Array.from(groupedCompanies.values()).map(companyGroup => ({
        name: companyGroup.name,
        externalId: companyGroup.externalId,
        locations: {
          nodes: companyGroup.locations
        },
        ...(includeMetafields && companyGroup.metafields ? {
          metafields: {
            edges: companyGroup.metafields.split('|').map((mf: string) => {
              const [keyPart, value] = mf.split(':');
              const [namespace, key] = keyPart.split('.');
              return {
                node: { namespace, key, value }
              };
            }).filter((edge: any) => edge.node.namespace && edge.node.key)
          }
        } : {})
      }));
    }

    if (!allCompanies.length) return new Response("No companies found", { status: 404 });

    // Flatten data: One row per location
    const csvData: any[] = [];

    for (const company of allCompanies) {
      const baseData = {
        name: company.name,
        company_id: company.externalId || '',
      };

      let metafieldsStr = '';
      if (includeMetafields && company.metafields) {
        metafieldsStr = company.metafields.edges?.map((edge: any) =>
          `${edge.node.namespace}.${edge.node.key}:${edge.node.value}`
        ).join('|') || '';
      }

      const locations = company.locations?.nodes || [];

      if (locations.length > 0) {
        // FIRST location: Include company name and company_id
        const firstLocation = locations[0];
        csvData.push({
          name: company.name, // Include company name
          company_id: company.externalId || '', // Include company_id
          location_name: firstLocation.name || company.name,
          location_id: firstLocation.id || '',
          shipping_street: firstLocation.shippingAddress?.address1 || '',
          shipping_city: firstLocation.shippingAddress?.city || '',
          shipping_state: firstLocation.shippingAddress?.zoneCode || '',
          shipping_zip: firstLocation.shippingAddress?.zip || '',
          shipping_country: firstLocation.shippingAddress?.countryCode || '',
          ...(includeMetafields ? { metafields: metafieldsStr } : {})
        });

        // SUBSEQUENT locations: Leave company name and company_id blank
        for (let i = 1; i < locations.length; i++) {
          const loc = locations[i];
          csvData.push({
            name: '', // Blank for subsequent locations
            company_id: '', // Blank for subsequent locations
            location_name: loc.name || '',
            location_id: loc.id || '',
            shipping_street: loc.shippingAddress?.address1 || '',
            shipping_city: loc.shippingAddress?.city || '',
            shipping_state: loc.shippingAddress?.zoneCode || '',
            shipping_zip: loc.shippingAddress?.zip || '',
            shipping_country: loc.shippingAddress?.countryCode || '',
            ...(includeMetafields ? { metafields: '' } : {}) // Only show metafields on first row
          });
        }
      } else {
        // Company with no locations
        csvData.push({
          name: company.name,
          company_id: company.externalId || '',
          location_name: '',
          location_id: '',
          shipping_street: '',
          shipping_city: '',
          shipping_state: '',
          shipping_zip: '',
          shipping_country: '',
          ...(includeMetafields ? { metafields: metafieldsStr } : {})
        });
      }
    }

    const columns = [
      'name', 'company_id',
      'location_name', 'location_id',
      'shipping_street', 'shipping_city', 'shipping_state', 'shipping_zip', 'shipping_country'
    ];
    if (includeMetafields) columns.push('metafields');

    const csvContent = stringify(csvData, { header: true, columns });
    const filename = `companies-export-${new Date().toISOString().split('T')[0]}.csv`;

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
      JSON.stringify({ error: "Failed to export companies" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}