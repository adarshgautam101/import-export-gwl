import { METAOBJECT_DEFS, ensureMetaobjectDefinition, createMetaobject, updateMetaobject, getMetaobject, listMetaobjects, countMetaobjects, getMetaobjectByHandle, generateMetaobjectHandle } from "../utils/metaobject.server";
import { ImportExportConfig } from "../config/import-export.config";
import { getCountryCode } from "../utils/country.server";

export interface CompanyData {
  id?: string; name: string; company_id?: string; main_contact_id?: string;
  contact_first_name?: string; contact_last_name?: string; contact_email?: string; contact_phone?: string;
  marketing_email_opt_in?: boolean; marketing_sms_opt_in?: boolean; location_id?: string; location_name?: string;
  shipping_street?: string; shipping_apartment_suite?: string; shipping_city?: string; shipping_state?: string;
  shipping_zip?: string; shipping_country?: string; shipping_phone?: string; shipping_first_name?: string;
  shipping_last_name?: string; shipping_company?: string; shipping_attention?: string;
  billing_same_as_shipping?: boolean; billing_street?: string; billing_apartment_suite?: string;
  billing_city?: string; billing_state?: string; billing_zip?: string; billing_country?: string;
  billing_phone?: string; billing_first_name?: string; billing_last_name?: string;
  billing_company?: string; billing_attention?: string; catalogs?: any; payment_terms?: string;
  no_payment_terms?: boolean; checkout_settings?: any; ship_to_any_address?: boolean;
  auto_submit_orders?: boolean; submit_all_as_drafts?: boolean; tax_settings?: any; tax_id?: string;
  collect_tax?: boolean; markets?: string[]; shopify_customer_id?: string; external_system_id?: string;
  metafields?: string;
  created_at?: Date; updated_at?: Date;
}



export async function createShopifyCompany(admin: any, companyData: CompanyData) {
  const MAX_RETRIES = ImportExportConfig.maxRetries;
  for (let retries = 0; retries < MAX_RETRIES; retries++) {
    try {
      const emailSuffix = `${Date.now()}${retries}`.substring(8);
      const baseName = companyData.name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase().substring(0, 15);
      const email = `${baseName}_${emailSuffix}@company-local.com`;

      // Parse metafields
      let metafieldsInput: any[] = [];
      if (companyData.metafields) {
        try {
          // Format: namespace.key:value|namespace.key:value
          metafieldsInput = companyData.metafields.split('|').map(mf => {
            const separatorIndex = mf.indexOf(':');
            if (separatorIndex === -1) return null;

            const keyPart = mf.substring(0, separatorIndex);
            const value = mf.substring(separatorIndex + 1);

            let [namespace, key] = keyPart.split('.');
            if (!key) {
              key = namespace;
              namespace = 'custom';
            }

            if (namespace && key && value) {
              return { namespace, key, value, type: "single_line_text_field" };
            }
            return null;
          }).filter(Boolean);
        } catch (e) {
          console.warn("Failed to parse metafields:", e);
        }
      }

      // Determine email to use
      let contactEmail = companyData.contact_email || email;

      // Check if company already exists in Shopify by name or external_id
      try {
        let queryString = "";
        if (companyData.company_id) {
          queryString = `external_id:"${companyData.company_id}"`;
        } else {
          queryString = `name:"${companyData.name}"`;
        }

        const checkQuery = await admin.graphql(`
          query($query: String!) {
            companies(first: 5, query: $query) {
              nodes {
                id
                name
                externalId
              }
            }
          }
        `, { variables: { query: queryString } });

        const checkResult = await checkQuery.json();
        if (checkResult.data?.companies?.nodes?.length > 0) {
          // If we searched by externalId, we should have an exact match
          if (companyData.company_id) {
            const match = checkResult.data.companies.nodes.find((n: any) => n.externalId === companyData.company_id);
            if (match) return { company: match, isNew: false };
          }

          // If we searched by name or didn't find by externalId, check for exact name match
          const nameMatch = checkResult.data.companies.nodes.find((n: any) => n.name === companyData.name);
          if (nameMatch) return { company: nameMatch, isNew: false };
        }
      } catch (error: any) {
        console.warn('Company existence check failed:', error.message);
      }

      const variables: any = {
        input: {
          company: {
            name: companyData.name,
            externalId: companyData.company_id
          },
          companyLocation: {
            name: companyData.location_name || companyData.name,
            externalId: companyData.location_id,
            billingAddress: {
              address1: companyData.billing_street || companyData.shipping_street || '',
              city: companyData.billing_city || companyData.shipping_city || '',
              zoneCode: companyData.billing_state || companyData.shipping_state || '',
              zip: companyData.billing_zip || companyData.shipping_zip || '',
              countryCode: getCountryCode(companyData.billing_country || companyData.shipping_country),
            },
            shippingAddress: {
              address1: companyData.shipping_street || '',
              city: companyData.shipping_city || '',
              zoneCode: companyData.shipping_state || '',
              zip: companyData.shipping_zip || '',
              countryCode: getCountryCode(companyData.shipping_country),
            }
          },
          ...(companyData.contact_email || companyData.contact_first_name || companyData.contact_last_name ? {
            companyContact: {
              firstName: companyData.contact_first_name || companyData.name.split(' ')[0] || 'Company',
              lastName: companyData.contact_last_name || companyData.name.split(' ').slice(1).join(' ') || 'Contact',
              email: contactEmail,
              locale: 'en'
            }
          } : {})
        },
      };

      const responseJson = await (await admin.graphql(`
        mutation companyCreate($input: CompanyCreateInput!) {
          companyCreate(input: $input) {
            company { 
              id 
              name 
              locations(first: 1) {
                nodes {
                  id
                }
              }
            }
            userErrors { field message }
          }
        }
      `, { variables })).json();



      const { companyCreate } = responseJson.data;
      if (companyCreate.userErrors?.length) {
        console.error(`❌ Shopify userErrors:`, companyCreate.userErrors);
        const emailError = companyCreate.userErrors.find((e: any) => e.field.includes('email') && e.message.includes('taken'));

        if (emailError) {
          // If email is taken, try to find the company by email to recover the ID
          console.log(`🔍 Email taken, attempting to find existing company by email: ${contactEmail}`);
          try {
            const findByEmailQuery = await admin.graphql(`
              query($query: String!) {
                companies(first: 1, query: $query) {
                  nodes {
                    id
                    name
                    externalId
                  }
                }
              }
            `, { variables: { query: `email:${contactEmail}` } });
            const findResult = await findByEmailQuery.json();
            if (findResult.data?.companies?.nodes?.length > 0) {
              const foundCompany = findResult.data.companies.nodes[0];

              // ONLY recover if the name matches OR the externalId matches
              const nameMatches = foundCompany.name.toLowerCase() === companyData.name.toLowerCase();
              const externalIdMatches = companyData.company_id && foundCompany.externalId === companyData.company_id;

              if (nameMatches || externalIdMatches) {
                console.log(`✅ Recovered existing company ID: ${foundCompany.id}`);
                return { company: foundCompany, isNew: false };
              } else {
                // User requirement: Do not modify email, drop the company if email is taken by someone else
                throw new Error(`Email ${contactEmail} is already taken by another company: "${foundCompany.name}" (ID: ${foundCompany.id})`);
              }
            }
          } catch (e: any) {
            if (e.message.includes('already taken')) throw e;
            console.warn('Failed to recover company by email:', e);
          }
          // If we couldn't find the company to recover it, but Shopify says email is taken,
          // it's a fatal error for this company.
          throw new Error(`Email ${contactEmail} is already taken by another company.`);
        }
        throw new Error(`Shopify API error for ${companyData.name}: ${companyCreate.userErrors.map((e: any) => e.message).join(', ')}`);
      }

      const company = companyCreate.company;

      // Set metafields if present
      if (company && metafieldsInput.length > 0) {

        const metafieldsVariables = {
          metafields: metafieldsInput.map(mf => ({
            ownerId: company.id,
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value,
            type: mf.type
          }))
        };

        const metafieldsResponse = await (await admin.graphql(`
          mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields {
                id
                namespace
                key
                value
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { variables: metafieldsVariables })).json();

        if (metafieldsResponse.data?.metafieldsSet?.userErrors?.length > 0) {
          console.error(`❌ Failed to set metafields for ${company.name}:`, metafieldsResponse.data.metafieldsSet.userErrors);
        } else {

        }
      }

      return { company, isNew: true };
    } catch (error) {
      console.error(`❌ Attempt ${retries + 1}/${MAX_RETRIES} failed for ${companyData.name}:`);
      console.error(`   Error:`, error);

      if (retries >= MAX_RETRIES - 1) {
        throw new Error(`Failed to create Shopify customer for ${companyData.name} after ${MAX_RETRIES} attempts. Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000 * (retries + 1)));
    }
  }
  return null; // Should not be reached if MAX_RETRIES > 0 and an error is always thrown on last retry
}

export async function createShopifyCompanyWithFallback(admin: any, companyData: CompanyData): Promise<{ company: any, isNew: boolean } | null> {
  try {
    return await createShopifyCompany(admin, companyData);
  } catch (error: any) {
    console.error(`❌ Shopify operation failed for ${companyData.name}:`);
    console.error(`   Error message: ${error.message}`);
    console.error(`   Full error:`, error);
    return null;
  }
}

export async function createShopifyCompanyLocation(admin: any, shopifyCompanyId: string, locationData: CompanyData) {
  try {
    // Check if location already exists by externalId
    if (locationData.location_id) {
      try {
        const checkQuery = await admin.graphql(`
          query($companyId: ID!) {
            company(id: $companyId) {
              locations(first: 250) {
                nodes {
                  id
                  externalId
                  name
                }
              }
            }
          }
        `, { variables: { companyId: shopifyCompanyId } });

        const checkResult = await checkQuery.json();
        const existingLocation = checkResult.data?.company?.locations?.nodes?.find(
          (loc: any) => loc.externalId === locationData.location_id
        );

        if (existingLocation) {
          console.log(`✓ Location "${locationData.location_name}" already exists with externalId ${locationData.location_id}`);
          return existingLocation;
        }
      } catch (checkError: any) {
        console.warn('Could not check for existing location:', checkError.message);
        // Continue with creation attempt
      }
    }



    const countryCode = getCountryCode(locationData.shipping_country);

    const responseJson = await (await admin.graphql(`
      mutation companyLocationCreate($companyId: ID!, $input: CompanyLocationInput!) {
        companyLocationCreate(companyId: $companyId, input: $input) {
          companyLocation {
            id
            name
            externalId
            shippingAddress {
              address1
              city
              zoneCode
              zip
              countryCode
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        companyId: shopifyCompanyId,
        input: {
          name: locationData.location_name || locationData.name,
          externalId: locationData.location_id,
          shippingAddress: {
            address1: locationData.shipping_street,
            city: locationData.shipping_city,
            zoneCode: locationData.shipping_state,
            zip: locationData.shipping_zip,
            countryCode: countryCode
          },
          ...(locationData.billing_same_as_shipping ? {
            billingAddress: {
              address1: locationData.shipping_street,
              city: locationData.shipping_city,
              zoneCode: locationData.shipping_state,
              zip: locationData.shipping_zip,
              countryCode: countryCode
            }
          } : locationData.billing_street ? {
            billingAddress: {
              address1: locationData.billing_street,
              city: locationData.billing_city,
              zoneCode: locationData.billing_state,
              zip: locationData.billing_zip,
              countryCode: getCountryCode(locationData.billing_country)
            }
          } : {})
        }
      }
    })).json();



    const { data } = responseJson;

    if (data?.companyLocationCreate?.userErrors?.length > 0) {
      console.error('❌ Shopify location creation errors:', data.companyLocationCreate.userErrors);
      return null;
    }

    const location = data?.companyLocationCreate?.companyLocation;
    if (location) {

    }

    return location;
  } catch (error: any) {
    console.error(`❌ Failed to create location for Shopify company ${shopifyCompanyId}:`, error.message);
    return null;
  }
}

export async function importCompanies(
  companies: CompanyData[],
  admin: any,
  format: 'json' | 'csv' = 'csv',
  onProgress?: (current: number, total: number) => void
) {
  const results = [];

  // Group companies by company_id to handle multi-location companies
  const companyGroups = new Map<string, CompanyData[]>();

  for (const company of companies) {
    const companyId = company.company_id || `COMP_${Date.now()}`;
    if (!companyGroups.has(companyId)) {
      companyGroups.set(companyId, []);
    }
    companyGroups.get(companyId)!.push(company);
  }

  // Process each company group
  let processedCount = 0;
  const totalGroups = companyGroups.size;

  for (const [companyId, locations] of companyGroups.entries()) {
    processedCount++;
    if (onProgress) onProgress(processedCount, totalGroups);

    let shopifySyncSuccessful = false;
    let shopifyCompanyId: string | null = null;
    let isNewCompany = false;

    try {
      // Use the first location as the main company data
      const mainCompany = locations[0];

      // Ensure Metaobject Definition exists (idempotent, fast check)
      await ensureMetaobjectDefinition(admin, METAOBJECT_DEFS.COMPANY);

      // Check if company already exists in Metaobjects using a consistent handle
      const companyHandle = generateMetaobjectHandle('company', companyId);
      const existingCompany = await getMetaobjectByHandle(admin, METAOBJECT_DEFS.COMPANY.type, companyHandle);

      // Create company in Shopify ONLY ONCE (before processing locations)
      if (existingCompany?.shopify_customer_id) {
        // Company already exists in Shopify, reuse the ID
        shopifyCompanyId = existingCompany.shopify_customer_id;
        shopifySyncSuccessful = true;
        isNewCompany = false;

      } else {
        // Create company in Shopify (only once, using first location data)

        const result = await createShopifyCompanyWithFallback(admin, mainCompany);
        if (result?.company?.id) {
          shopifyCompanyId = result.company.id;
          isNewCompany = result.isNew;
          shopifySyncSuccessful = true;

        } else {

        }
      }

      // Create additional locations in Shopify (if company was successfully created/found)
      if (shopifyCompanyId && shopifySyncSuccessful) {
        // If we created a NEW company, the first location (index 0) was used for the main address.
        // If we REUSED a company, we should check ALL locations in this batch to ensure they exist.
        const startIndex = isNewCompany ? 1 : 0;

        if (locations.length > startIndex) {
          console.log(`📍 Creating ${locations.length - startIndex} additional location(s) for company ${shopifyCompanyId}...`);

          for (let i = startIndex; i < locations.length; i++) {
            const additionalLocation = locations[i];
            try {
              console.log(`  → Location ${i + 1}/${locations.length}: "${additionalLocation.location_name}" (externalId: ${additionalLocation.location_id})`);

              const shopifyLocation = await createShopifyCompanyLocation(
                admin,
                shopifyCompanyId,
                additionalLocation
              );

              if (shopifyLocation) {
                console.log(`  ✓ Successfully created/found location: "${additionalLocation.location_name}" (ID: ${shopifyLocation.id})`);
              } else {
                console.warn(`  ⚠ Location creation returned null: "${additionalLocation.location_name}"`);
              }
            } catch (error: any) {
              console.error(`  ❌ Error creating location "${additionalLocation.location_name}":`, error.message);
            }
          }
        }
      }
      // Save all locations to local database ONLY if Shopify sync was successful
      if (!shopifyCompanyId || !shopifySyncSuccessful) {
        console.warn(`⚠️ Skipping Metaobject creation for company ${companyId} because Shopify sync failed.`);
        for (const location of locations) {
          results.push({
            success: false,
            action: 'skipped',
            shopify_sync: false,
            company_id: companyId,
            location_id: location.location_id,
            location_name: location.location_name,
            message: `Skipped: Company could not be created/found in Shopify.`
          });
        }
        continue; // Skip to next company
      }

      // Save all locations to local database
      for (const location of locations) {
        try {
          const dataForDb = {
            company_id: companyId,
            name: location.name,
            location_id: location.location_id,
            location_name: location.location_name,

            // Group Contact Info
            contact_info: JSON.stringify({
              main_contact_id: location.main_contact_id,
              contact_first_name: location.contact_first_name,
              contact_last_name: location.contact_last_name,
              contact_email: location.contact_email,
              contact_phone: location.contact_phone,
              marketing_email_opt_in: location.marketing_email_opt_in,
              marketing_sms_opt_in: location.marketing_sms_opt_in
            }),

            // Group Shipping Address
            shipping_address: JSON.stringify({
              street: location.shipping_street,
              apartment_suite: location.shipping_apartment_suite,
              city: location.shipping_city,
              state: location.shipping_state,
              zip: location.shipping_zip,
              country: location.shipping_country,
              phone: location.shipping_phone,
              first_name: location.shipping_first_name,
              last_name: location.shipping_last_name,
              company: location.shipping_company,
              attention: location.shipping_attention
            }),

            // Group Billing Address
            billing_address: JSON.stringify({
              same_as_shipping: location.billing_same_as_shipping,
              street: location.billing_street,
              apartment_suite: location.billing_apartment_suite,
              city: location.billing_city,
              state: location.billing_state,
              zip: location.billing_zip,
              country: location.billing_country,
              phone: location.billing_phone,
              first_name: location.billing_first_name,
              last_name: location.billing_last_name,
              company: location.billing_company,
              attention: location.billing_attention
            }),

            catalogs: location.catalogs ? JSON.stringify(location.catalogs) : undefined,
            payment_terms: location.payment_terms,
            no_payment_terms: location.no_payment_terms,
            checkout_settings: location.checkout_settings ? JSON.stringify(location.checkout_settings) : undefined,
            ship_to_any_address: location.ship_to_any_address,
            auto_submit_orders: location.auto_submit_orders,
            submit_all_as_drafts: location.submit_all_as_drafts,
            tax_settings: location.tax_settings ? JSON.stringify(location.tax_settings) : undefined,
            tax_id: location.tax_id,
            collect_tax: location.collect_tax,
            markets: location.markets ? JSON.stringify(location.markets) : undefined,
            shopify_customer_id: shopifyCompanyId,
            external_system_id: 'customer',
            stored_metafields: location.metafields,
            created_at: new Date(),
            updated_at: new Date()
          };

          // Check if this specific location already exists using a consistent handle
          const locationHandle = generateMetaobjectHandle('loc', companyId, location.location_id);
          const existingLocation = await getMetaobjectByHandle(admin, METAOBJECT_DEFS.COMPANY.type, locationHandle);

          if (existingLocation) {
            await updateMetaobject(admin, existingLocation.id, dataForDb);
            results.push({
              success: true,
              action: 'updated',
              shopify_sync: shopifySyncSuccessful,
              company_id: companyId,
              location_id: location.location_id,
              location_name: location.location_name,
              shopify_id: shopifyCompanyId,
              message: shopifySyncSuccessful
                ? `Location updated & linked to Shopify company`
                : `Location updated (local only)`
            });
          } else {
            await createMetaobject(admin, METAOBJECT_DEFS.COMPANY.type, dataForDb, locationHandle);
            results.push({
              success: true,
              action: 'created',
              shopify_sync: shopifySyncSuccessful,
              company_id: companyId,
              location_id: location.location_id,
              location_name: location.location_name,
              shopify_id: shopifyCompanyId,
              message: shopifySyncSuccessful
                ? `Location created & linked to Shopify company`
                : `Location created (local only)`
            });
          }
        } catch (locationError: any) {
          console.error(`❌ Error saving location ${location.location_id}:`, locationError);
          results.push({
            success: false,
            action: 'failed',
            shopify_sync: false,
            company_id: companyId,
            location_id: location.location_id,
            error: locationError.message || 'Unknown error'
          });
        }
      }

    } catch (error: any) {
      console.error(`❌ Error importing company ${companyId}:`, error);
      results.push({
        success: false,
        action: 'failed',
        shopify_sync: false,
        company_id: companyId,
        error: error.message || 'Unknown error'
      });
    }
  }

  return results;
}

export async function syncCompaniesWithShopify(admin: any) {
  // Fetch companies that don't have a shopify_customer_id
  // Note: Metaobject filtering is limited. We might need to fetch all and filter in memory if the list is small, 
  // or rely on a specific query if supported. For now, let's try querying by empty field if possible, or just iterate.
  // Since "IS NULL" isn't standard in simple search syntax, we might need to iterate.
  // Optimization: For now, we'll fetch a batch and filter.
  const { nodes: allCompanies } = await listMetaobjects(admin, METAOBJECT_DEFS.COMPANY.type, 50);
  const companiesToSync = allCompanies.filter((c: any) => !c.shopify_customer_id);
  const results = [];

  for (const company of companiesToSync) {
    try {
      const result = await createShopifyCompanyWithFallback(admin, company as unknown as CompanyData);
      if (result?.company?.id) {
        await updateMetaobject(admin, company.id, {
          shopify_customer_id: result.company.id,
          external_system_id: 'customer'
        });
        results.push({ success: true, company_id: company.company_id, shopify_id: result.company.id, shopify_type: 'customer', action: 'created_in_shopify' });
      } else {
        results.push({ success: false, company_id: company.company_id, error: 'Failed to get Shopify customer ID during sync (check logs for details)', action: 'shopify_creation_failed' });
      }
    } catch (error: any) {
      results.push({ success: false, company_id: company.company_id, error: error.message, action: 'sync_failed' });
    }
  }

  // Count synced companies
  // This is an approximation or requires iteration.
  const alreadySyncedCount = 0; // Placeholder as we can't easily count with "NOT NULL" query efficiently without iteration
  if (alreadySyncedCount > 0) {
    results.push({ success: true, action: 'already_synced', message: `${alreadySyncedCount} companies were already synchronized.` });
  }

  return results;
}

export const getAllCompanies = async (admin: any, page = 1, pageSize = 20, cursor?: string) => {
  const { nodes: rawCompanies, pageInfo } = await listMetaobjects(admin, METAOBJECT_DEFS.COMPANY.type, pageSize, cursor);

  const companies = rawCompanies.map((c: any) => {
    const contactInfo = typeof c.contact_info === 'string' ? JSON.parse(c.contact_info) : (c.contact_info || {});
    const shippingAddress = typeof c.shipping_address === 'string' ? JSON.parse(c.shipping_address) : (c.shipping_address || {});
    const billingAddress = typeof c.billing_address === 'string' ? JSON.parse(c.billing_address) : (c.billing_address || {});

    return {
      id: c.id,
      company_id: c.company_id,
      name: c.name,
      location_id: c.location_id,
      location_name: c.location_name,

      // Flatten Contact Info
      main_contact_id: contactInfo.main_contact_id,
      contact_first_name: contactInfo.contact_first_name,
      contact_last_name: contactInfo.contact_last_name,
      contact_email: contactInfo.contact_email,
      contact_phone: contactInfo.contact_phone,
      marketing_email_opt_in: contactInfo.marketing_email_opt_in,
      marketing_sms_opt_in: contactInfo.marketing_sms_opt_in,

      // Flatten Shipping Address
      shipping_street: shippingAddress.street,
      shipping_apartment_suite: shippingAddress.apartment_suite,
      shipping_city: shippingAddress.city,
      shipping_state: shippingAddress.state,
      shipping_zip: shippingAddress.zip,
      shipping_country: shippingAddress.country,
      shipping_phone: shippingAddress.phone,
      shipping_first_name: shippingAddress.first_name,
      shipping_last_name: shippingAddress.last_name,
      shipping_company: shippingAddress.company,
      shipping_attention: shippingAddress.attention,

      // Flatten Billing Address
      billing_same_as_shipping: billingAddress.same_as_shipping,
      billing_street: billingAddress.street,
      billing_apartment_suite: billingAddress.apartment_suite,
      billing_city: billingAddress.city,
      billing_state: billingAddress.state,
      billing_zip: billingAddress.zip,
      billing_country: billingAddress.country,
      billing_phone: billingAddress.phone,
      billing_first_name: billingAddress.first_name,
      billing_last_name: billingAddress.last_name,
      billing_company: billingAddress.company,
      billing_attention: billingAddress.attention,

      // Other fields
      catalogs: typeof c.catalogs === 'string' ? JSON.parse(c.catalogs) : c.catalogs,
      payment_terms: c.payment_terms,
      no_payment_terms: c.no_payment_terms,
      checkout_settings: typeof c.checkout_settings === 'string' ? JSON.parse(c.checkout_settings) : c.checkout_settings,
      ship_to_any_address: c.ship_to_any_address,
      auto_submit_orders: c.auto_submit_orders,
      submit_all_as_drafts: c.submit_all_as_drafts,
      tax_settings: typeof c.tax_settings === 'string' ? JSON.parse(c.tax_settings) : c.tax_settings,
      tax_id: c.tax_id,
      collect_tax: c.collect_tax,
      markets: typeof c.markets === 'string' ? JSON.parse(c.markets) : c.markets,
      shopify_customer_id: c.shopify_customer_id,
      external_system_id: c.external_system_id,
      metafields: c.stored_metafields,
      created_at: c.created_at,
      updated_at: c.updated_at
    };
  });

  const total = 0;

  return {
    companies,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: 0,
      hasNextPage: pageInfo.hasNextPage,
      hasPreviousPage: false,
      endCursor: pageInfo.endCursor
    },
  };
};

export async function getCompanyStats(admin: any) {
  const { nodes: allCompanies } = await listMetaobjects(admin, METAOBJECT_DEFS.COMPANY.type, 250);

  // Count unique company_ids (one company can have multiple locations)
  const uniqueCompanyIds = new Set(allCompanies.map((c: any) => c.company_id));
  const totalCompanies = uniqueCompanyIds.size;

  // Count how many unique companies have shopify_customer_id
  const companiesWithShopifyId = new Set(
    allCompanies
      .filter((c: any) => c.shopify_customer_id)
      .map((c: any) => c.company_id)
  );

  return {
    totalCompanies,
    companiesSyncedWithShopify: companiesWithShopifyId.size,
    companiesNotSynced: totalCompanies - companiesWithShopifyId.size
  };
}

export const exportCompanies = (admin: any) => listMetaobjects(admin, METAOBJECT_DEFS.COMPANY.type, 250).then(res => res.nodes);