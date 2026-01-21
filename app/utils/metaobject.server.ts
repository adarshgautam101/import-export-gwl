import { ImportExportConfig } from "../config/import-export.config";

export const METAOBJECT_DEFS = {
  COMPANY: {
    type: "app_company",
    name: "App Company",
    fieldDefinitions: [
      { key: "company_id", name: "Company ID", type: "single_line_text_field" },
      { key: "name", name: "Name", type: "single_line_text_field" },
      { key: "contact_info", name: "Contact Info", type: "json" },
      { key: "location_id", name: "Location ID", type: "single_line_text_field" },
      { key: "location_name", name: "Location Name", type: "single_line_text_field" },
      { key: "shipping_address", name: "Shipping Address", type: "json" },
      { key: "billing_address", name: "Billing Address", type: "json" },
      { key: "catalogs", name: "Catalogs", type: "json" },
      { key: "payment_terms", name: "Payment Terms", type: "single_line_text_field" },
      { key: "no_payment_terms", name: "No Payment Terms", type: "boolean" },
      { key: "checkout_settings", name: "Checkout Settings", type: "json" },
      { key: "ship_to_any_address", name: "Ship To Any Address", type: "boolean" },
      { key: "auto_submit_orders", name: "Auto Submit Orders", type: "boolean" },
      { key: "submit_all_as_drafts", name: "Submit All As Drafts", type: "boolean" },
      { key: "tax_settings", name: "Tax Settings", type: "json" },
      { key: "tax_id", name: "Tax ID", type: "single_line_text_field" },
      { key: "collect_tax", name: "Collect Tax", type: "boolean" },
      { key: "markets", name: "Markets", type: "json" },
      { key: "shopify_customer_id", name: "Shopify Customer ID", type: "single_line_text_field" },
      { key: "external_system_id", name: "External System ID", type: "single_line_text_field" },
      { key: "stored_metafields", name: "Stored Metafields", type: "multi_line_text_field" },
      { key: "created_at", name: "Created At", type: "date_time" },
      { key: "updated_at", name: "Updated At", type: "date_time" },
    ]
  },
  COLLECTION: {
    type: "app_collection",
    name: "App Collection",
    fieldDefinitions: [
      { key: "shopify_id", name: "Shopify ID", type: "single_line_text_field" },
      { key: "title", name: "Title", type: "single_line_text_field" },
      { key: "description", name: "Description", type: "multi_line_text_field" },
      { key: "collection_type", name: "Collection Type", type: "single_line_text_field" },
      { key: "collection_handle", name: "Collection Handle", type: "single_line_text_field" },
      { key: "seo_title", name: "SEO Title", type: "single_line_text_field" },
      { key: "meta_description", name: "Meta Description", type: "multi_line_text_field" },
      { key: "image_url", name: "Image URL", type: "url" },
      { key: "product_ids", name: "Product IDs", type: "json" },
      { key: "rule_set", name: "Rule Set", type: "json" },
      { key: "stored_metafields", name: "Stored Metafields", type: "multi_line_text_field" },
      { key: "created_at", name: "Created At", type: "date_time" },
      { key: "updated_at", name: "Updated At", type: "date_time" },
    ]
  },
  DISCOUNT: {
    type: "app_discount",
    name: "App Discount",
    fieldDefinitions: [
      { key: "shopify_id", name: "Shopify ID", type: "single_line_text_field" },
      { key: "title", name: "Title", type: "single_line_text_field" },
      { key: "description", name: "Description", type: "multi_line_text_field" },
      { key: "discount_type", name: "Discount Type", type: "single_line_text_field" },
      { key: "value", name: "Value", type: "number_decimal" },
      { key: "code", name: "Code", type: "single_line_text_field" },
      { key: "buy_quantity", name: "Buy Quantity", type: "number_integer" },
      { key: "get_quantity", name: "Get Quantity", type: "number_integer" },
      { key: "get_discount", name: "Get Discount", type: "number_decimal" },
      { key: "applies_to", name: "Applies To", type: "single_line_text_field" },
      { key: "customer_eligibility", name: "Customer Eligibility", type: "single_line_text_field" },
      { key: "minimum_requirement_type", name: "Minimum Requirement Type", type: "single_line_text_field" },
      { key: "minimum_requirement_value", name: "Minimum Requirement Value", type: "number_decimal" },
      { key: "usage_limit", name: "Usage Limit", type: "number_integer" },
      { key: "one_per_customer", name: "One Per Customer", type: "boolean" },
      { key: "combines_with_product_discounts", name: "Combines With Product Discounts", type: "boolean" },
      { key: "combines_with_order_discounts", name: "Combines With Order Discounts", type: "boolean" },
      { key: "combines_with_shipping_discounts", name: "Combines With Shipping Discounts", type: "boolean" },
      { key: "starts_at", name: "Starts At", type: "date_time" },
      { key: "ends_at", name: "Ends At", type: "date_time" },
      { key: "product_ids", name: "Product IDs", type: "json" },
      { key: "collection_ids", name: "Collection IDs", type: "json" },
      { key: "status", name: "Status", type: "single_line_text_field" },
      { key: "created_at", name: "Created At", type: "date_time" },
      { key: "updated_at", name: "Updated At", type: "date_time" },
    ]
  }
};

export async function ensureMetaobjectDefinition(admin: any, definitionConfig: any) {
  try {
    const response = await admin.graphql(`
      query($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
          fieldDefinitions {
            key
          }
        }
      }
    `, { variables: { type: definitionConfig.type } });

    const { data } = await response.json();

    if (data?.metaobjectDefinitionByType) {
      // Definition exists, we could check for missing fields here if needed
      return data.metaobjectDefinitionByType.id;
    }

    // Create definition
    const createResponse = await admin.graphql(`
      mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition {
            id
            type
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        definition: {
          name: definitionConfig.name,
          type: definitionConfig.type,
          fieldDefinitions: definitionConfig.fieldDefinitions,
          access: {
            storefront: "PUBLIC_READ"
          }
        }
      }
    });

    const createResult = await createResponse.json();
    if (createResult.data?.metaobjectDefinitionCreate?.userErrors?.length > 0) {
      console.error("Failed to create metaobject definition:", createResult.data.metaobjectDefinitionCreate.userErrors);
      throw new Error(createResult.data.metaobjectDefinitionCreate.userErrors[0].message);
    }

    return createResult.data?.metaobjectDefinitionCreate?.metaobjectDefinition?.id;
  } catch (error) {
    console.error(`Error ensuring metaobject definition for ${definitionConfig.type}:`, error);
    throw error;
  }
}

export async function hasMetaobjectDefinition(admin: any, type: string) {
  const response = await admin.graphql(`
      query($type: String!) {
        metaobjectDefinitionByType(type: $type) {
          id
        }
      }
    `, { variables: { type } });

  const { data } = await response.json();
  return !!data?.metaobjectDefinitionByType;
}

export async function createMetaobject(admin: any, type: string, data: any, handle?: string) {
  const fields = Object.entries(data).map(([key, value]) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && isNaN(value)) return null;
    let stringValue;
    if (value instanceof Date) {
      stringValue = value.toISOString();
    } else if (typeof value === 'object') {
      stringValue = JSON.stringify(value);
    } else {
      stringValue = String(value);
    }
    return {
      key,
      value: stringValue
    };
  }).filter(Boolean);

  const response = await admin.graphql(`
    mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      metaobject: {
        type,
        handle,
        fields
      }
    }
  });

  const result = await response.json();
  if (result.data?.metaobjectCreate?.userErrors?.length > 0) {
    throw new Error(result.data.metaobjectCreate.userErrors.map((e: any) => e.message).join(', '));
  }

  return result.data?.metaobjectCreate?.metaobject;
}

export async function updateMetaobject(admin: any, id: string, data: any) {
  const fields = Object.entries(data).map(([key, value]) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' && isNaN(value)) return null;
    let stringValue;
    if (value instanceof Date) {
      stringValue = value.toISOString();
    } else if (typeof value === 'object') {
      stringValue = JSON.stringify(value);
    } else {
      stringValue = String(value);
    }
    return {
      key,
      value: stringValue
    };
  }).filter(Boolean);

  const response = await admin.graphql(`
    mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `, {
    variables: {
      id,
      metaobject: {
        fields
      }
    }
  });

  const result = await response.json();
  if (result.data?.metaobjectUpdate?.userErrors?.length > 0) {
    throw new Error(result.data.metaobjectUpdate.userErrors.map((e: any) => e.message).join(', '));
  }

  return result.data?.metaobjectUpdate?.metaobject;
}

export async function getMetaobject(admin: any, type: string, query?: string) {
  const response = await admin.graphql(`
    query($type: String!, $query: String) {
      metaobjects(type: $type, first: 1, query: $query) {
        nodes {
          id
          handle
          fields {
            key
            value
            type
          }
        }
      }
    }
  `, {
    variables: {
      type,
      query
    }
  });

  const result = await response.json();
  const node = result.data?.metaobjects?.nodes?.[0];

  if (!node) return null;

  return parseMetaobjectFields(node);
}

export async function getMetaobjectByHandle(admin: any, type: string, handle: string) {
  // Using metaobjects query with handle filter as it's more compatible across API versions
  // than the direct metaobject(handle: ...) field which sometimes requires an ID.
  const response = await admin.graphql(`
    query($type: String!, $query: String!) {
      metaobjects(first: 1, type: $type, query: $query) {
        nodes {
          id
          handle
          fields {
            key
            value
            type
          }
        }
      }
    }
  `, {
    variables: {
      type,
      query: `handle:"${handle}"`
    }
  });

  const result = await response.json();
  const node = result.data?.metaobjects?.nodes?.[0];

  if (!node) return null;

  return parseMetaobjectFields(node);
}

export function generateMetaobjectHandle(prefix: string, id: string, subId?: string) {
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const cleanId = id.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const cleanSubId = subId ? subId.toLowerCase().replace(/[^a-z0-9]/g, '-') : '';

  return `${cleanPrefix}-${cleanId}${cleanSubId ? `-${cleanSubId}` : ''}`.substring(0, 64);
}

export async function listMetaobjects(admin: any, type: string, first = 20, after?: string) {
  const response = await admin.graphql(`
    query($type: String!, $first: Int!, $after: String) {
      metaobjects(type: $type, first: $first, after: $after, reverse: true) {
        nodes {
          id
          handle
          updatedAt
          fields {
            key
            value
            type
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `, {
    variables: {
      type,
      first,
      after
    }
  });

  const result = await response.json();
  const nodes = result.data?.metaobjects?.nodes || [];

  return {
    nodes: nodes.map(parseMetaobjectFields),
    pageInfo: result.data?.metaobjects?.pageInfo
  };
}

export async function countMetaobjects(admin: any, type: string) {
  const response = await admin.graphql(`
    query($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        metaobjectsCount
      }
    }
  `, {
    variables: { type }
  });

  const result = await response.json();
  return result.data?.metaobjectDefinitionByType?.metaobjectsCount || 0;
}

function parseMetaobjectFields(node: any) {
  const data: any = { id: node.id, handle: node.handle, updated_at: node.updatedAt };
  node.fields.forEach((f: any) => {
    try {
      if (f.type === 'json' || f.type === 'list.single_line_text_field') {
        data[f.key] = JSON.parse(f.value);
      } else if (f.type === 'boolean') {
        data[f.key] = f.value === 'true';
      } else if (f.type === 'number_integer') {
        data[f.key] = parseInt(f.value);
      } else if (f.type === 'number_decimal') {
        data[f.key] = parseFloat(f.value);
      } else {
        data[f.key] = f.value;
      }
    } catch (e) {
      data[f.key] = f.value;
    }
  });
  return data;
}
