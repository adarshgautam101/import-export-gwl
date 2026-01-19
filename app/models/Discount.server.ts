// app/models/Discount.server.ts
import { METAOBJECT_DEFS, ensureMetaobjectDefinition, createMetaobject, updateMetaobject, listMetaobjects, countMetaobjects } from "../utils/metaobject.server";
import { ImportExportConfig } from "../config/import-export.config";

export interface CreateDiscountData {
  title: string;
  description?: string;
  discount_type: 'percentage' | 'fixed_amount' | 'shipping' | 'buy_x_get_y';
  value?: number;
  code?: string;
  buy_quantity?: number;
  get_quantity?: number;
  get_discount?: number;
  applies_to?: 'all' | 'specific_products' | 'specific_collections';
  customer_eligibility?: 'all' | 'specific_segments' | 'specific_customers';
  minimum_requirement_type?: 'none' | 'subtotal' | 'quantity';
  minimum_requirement_value?: number;
  usage_limit?: number;
  one_per_customer?: boolean;
  combines_with_product_discounts?: boolean;
  combines_with_order_discounts?: boolean;
  combines_with_shipping_discounts?: boolean;
  starts_at?: Date;
  ends_at?: Date;
  product_ids?: string[];
  collection_ids?: string[];
  shopify_id?: string;
  status?: 'active' | 'draft' | 'archived';
  stored_metafields?: string | null;
}

export async function getAllLocalDiscounts(admin: any, page = 1, pageSize = 20, cursor?: string) {
  const { nodes: discounts, pageInfo } = await listMetaobjects(admin, METAOBJECT_DEFS.DISCOUNT.type, pageSize, cursor);
  const total = await countMetaobjects(admin, METAOBJECT_DEFS.DISCOUNT.type);

  const formattedDiscounts = discounts.map((discount: any) => ({
    ...discount,
    product_ids: typeof discount.product_ids === 'string' ? JSON.parse(discount.product_ids) : (discount.product_ids || []),
    collection_ids: typeof discount.collection_ids === 'string' ? JSON.parse(discount.collection_ids) : (discount.collection_ids || [])
  }));

  return {
    discounts: formattedDiscounts,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasNextPage: pageInfo.hasNextPage,
      hasPreviousPage: false,
      endCursor: pageInfo.endCursor
    },
  };
}

export async function createDiscount(admin: any, data: CreateDiscountData) {
  await ensureMetaobjectDefinition(admin, METAOBJECT_DEFS.DISCOUNT);

  return createMetaobject(admin, METAOBJECT_DEFS.DISCOUNT.type, {
    ...data,
    product_ids: data.product_ids?.length ? JSON.stringify(data.product_ids) : undefined,
    collection_ids: data.collection_ids?.length ? JSON.stringify(data.collection_ids) : undefined,
  });
}

const handleGraphQLResponse = async (response: any) => {
  if (response instanceof Response) {
    if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    try {
      const text = await response.text();
      if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
        return JSON.parse(text);
      }
      throw new Error(`Expected JSON but got: ${text.substring(0, 200)}`);
    } catch (error: any) {
      throw new Error(`Failed to read response: ${error.message}`);
    }
  }
  return response;
};

export async function verifyAppPermissions(admin: any) {
  try {
    const result = await handleGraphQLResponse(await admin.graphql(`
      query { shop { name primaryDomain { url } } }
    `));
    return !!(result?.data?.shop?.name || result?.shop?.name);
  } catch (error) {
    console.error('App permissions check failed:', error);
    return false;
  }
}

const checkIfCodeExists = async (admin: any, code: string): Promise<boolean> => {
  try {
    const result = await handleGraphQLResponse(await admin.graphql(`
      query($query: String!) {
        codeDiscountNodes(first: 1, query: $query) {
          nodes { id }
        }
      }
    `, { variables: { query: `code:${code}` } }));
    return (result.data?.codeDiscountNodes?.nodes || []).length > 0;
  } catch (error) {
    return false;
  }
};

const generateUniqueCode = (baseCode: string, attempt: number = 1): string => {
  if (attempt === 1) return baseCode;
  const timestamp = Date.now().toString().slice(-4);
  const randomChars = Math.random().toString(36).substring(2, 5).toUpperCase();
  return attempt <= ImportExportConfig.codeRetryThreshold1 ? `${baseCode}_${timestamp}` :
    attempt <= ImportExportConfig.codeRetryThreshold2 ? `${baseCode}_${randomChars}` :
      `${baseCode}_${timestamp}_${randomChars}`;
};

const getAllExistingCodes = async (admin: any): Promise<string[]> => {
  try {
    const result = await handleGraphQLResponse(await admin.graphql(`
      query {
        codeDiscountNodes(first: 50) {
          nodes {
            codeDiscount {
              ... on DiscountCodeBasic { codes(first: 10) { nodes { code } } }
              ... on DiscountCodeBxgy { codes(first: 10) { nodes { code } } }
              ... on DiscountCodeFreeShipping { codes(first: 10) { nodes { code } } }
            }
          }
        }
      }
    `));
    const codes: string[] = [];
    (result.data?.codeDiscountNodes?.nodes || []).forEach((node: any) => {
      const codeNodes = node.codeDiscount?.codes?.nodes || [];
      codeNodes.forEach((codeNode: any) => {
        if (codeNode.code) codes.push(codeNode.code);
      });
    });
    return codes;
  } catch (error) {
    return [];
  }
};

const findUniqueCode = async (admin: any, baseCode: string, existingCodes: string[] = []): Promise<string> => {
  if (!existingCodes.length) existingCodes = await getAllExistingCodes(admin);
  if (!existingCodes.includes(baseCode)) return baseCode;

  for (let attempt = 1; attempt <= ImportExportConfig.maxCodeGenerationAttempts; attempt++) {
    const newCode = generateUniqueCode(baseCode, attempt);
    if (!existingCodes.includes(newCode)) return newCode;
  }
  return `${baseCode}_${Date.now().toString().slice(-8)}`;
};

export async function createDiscountInShopify(admin: any, discountData: CreateDiscountData) {
  const baseCode = discountData.code ||
    (discountData.discount_type === 'buy_x_get_y' ?
      `BXGY_${discountData.title.replace(/\s+/g, '_').toUpperCase()}` :
      discountData.discount_type === 'shipping' ?
        `SHIP_${discountData.title.replace(/\s+/g, '_').toUpperCase()}` :
        `DSC_${discountData.title.replace(/\s+/g, '_').toUpperCase()}`);

  if (discountData.discount_type === 'buy_x_get_y') {
    return createBuyXGetYDiscount(admin, { ...discountData, code: baseCode });
  } else if (discountData.discount_type === 'shipping') {
    return createFreeShippingDiscount(admin, { ...discountData, code: baseCode });
  } else {
    return createBasicDiscount(admin, { ...discountData, code: baseCode });
  }
}

async function createFreeShippingDiscount(admin: any, discountData: CreateDiscountData) {
  const createWithRetry = async (retryCount = 0): Promise<any> => {
    let discountCode = retryCount > 0 ? generateUniqueCode(discountData.code || '', retryCount) : discountData.code;

    const variables = {
      freeShippingCodeDiscount: {
        title: discountData.title,
        code: discountCode,
        startsAt: discountData.starts_at?.toISOString() || new Date().toISOString(),
        endsAt: discountData.ends_at?.toISOString() || null,
        usageLimit: discountData.usage_limit || null,
        customerSelection: { all: true },
        appliesOncePerCustomer: discountData.one_per_customer || false,
        destination: { all: true },
        combinesWith: {
          orderDiscounts: discountData.combines_with_order_discounts || false,
          productDiscounts: discountData.combines_with_product_discounts || false,
          shippingDiscounts: discountData.combines_with_shipping_discounts || false,
        }
      }
    };

    try {
      const result = await handleGraphQLResponse(await admin.graphql(`
        mutation discountCodeFreeShippingCreate($freeShippingCodeDiscount: DiscountCodeFreeShippingInput!) {
          discountCodeFreeShippingCreate(freeShippingCodeDiscount: $freeShippingCodeDiscount) {
            codeDiscountNode {
              id
              codeDiscount {
                ... on DiscountCodeFreeShipping {
                  title
                  codes(first: 1) { nodes { code } }
                  status
                }
              }
            }
            userErrors { field message }
          }
        }
      `, { variables }));

      const userErrors = result.data?.discountCodeFreeShippingCreate?.userErrors;
      if (userErrors?.length) {
        const hasDuplicateCode = userErrors.some((e: any) =>
          e.message.includes('must be unique') || e.message.includes('unique') || e.field?.includes('code')
        );
        if (hasDuplicateCode && retryCount < 3) return createWithRetry(retryCount + 1);
        throw new Error(`Shopify API Error (Shipping): ${userErrors.map((e: any) => `${e.field}: ${e.message}`).join(', ')}`);
      }

      const discountNode = result.data?.discountCodeFreeShippingCreate?.codeDiscountNode;
      if (!discountNode) throw new Error('No discount node returned from Shopify API for Shipping discount.');

      return {
        id: discountNode.id,
        title: discountNode.codeDiscount?.title,
        code: discountNode.codeDiscount?.codes?.nodes?.[0]?.code,
        status: discountNode.codeDiscount?.status
      };
    } catch (error: any) {
      throw new Error(`GraphQL execution failed for Shipping: ${error.message}`);
    }
  };

  const result = await createWithRetry();

  if (result?.id && discountData.stored_metafields) {
    await setDiscountMetafields(admin, result.id, discountData.stored_metafields, discountData.title);
  }

  return result;
}

const buildCustomerGets = (discountData: CreateDiscountData) => {
  const customerGets: any = { items: {} };

  if (discountData.discount_type === 'shipping') {
    customerGets.value = { discountAmount: { amount: "0.0" } };
    customerGets.items.all = true;
  } else if (discountData.discount_type === 'percentage') {
    customerGets.value = { percentage: (discountData.value || ImportExportConfig.defaultPercentageDiscount) / 100 };
    customerGets.items.all = discountData.applies_to === 'all';
  } else if (discountData.discount_type === 'fixed_amount') {
    customerGets.value = { discountAmount: { amount: (discountData.value || 10).toFixed(2) } };
    customerGets.items.all = discountData.applies_to === 'all';
  }

  if (discountData.discount_type !== 'shipping') {
    if (discountData.applies_to === 'specific_products' && discountData.product_ids?.length) {
      const uniqueProductIds = [...new Set(discountData.product_ids)];
      customerGets.items = { products: { products: uniqueProductIds.map(id => `gid://shopify/Product/${id}`) } };
    } else if (discountData.applies_to === 'specific_collections' && discountData.collection_ids?.length) {
      const uniqueCollectionIds = [...new Set(discountData.collection_ids)];
      customerGets.items = { collections: { collections: uniqueCollectionIds.map(id => `gid://shopify/Collection/${id}`) } };
    }
  }
  return customerGets;
};

const buildMinimumRequirement = (data: CreateDiscountData) => {
  if (!data.minimum_requirement_type || data.minimum_requirement_type === 'none' || !data.minimum_requirement_value) return null;
  return data.minimum_requirement_type === 'subtotal'
    ? { subtotal: { greaterThanOrEqualToSubtotal: data.minimum_requirement_value.toFixed(2) } }
    : { quantity: { greaterThanOrEqualToQuantity: data.minimum_requirement_value.toString() } };
};

async function createBasicDiscount(admin: any, discountData: CreateDiscountData) {
  const createWithRetry = async (retryCount = 0): Promise<any> => {
    let discountCode = retryCount > 0 ? generateUniqueCode(discountData.code || '', retryCount) : discountData.code;

    const variables = {
      basicCodeDiscount: {
        title: discountData.title,
        code: discountCode,
        startsAt: discountData.starts_at?.toISOString() || new Date().toISOString(),
        endsAt: discountData.ends_at?.toISOString() || null,
        usageLimit: discountData.usage_limit || null,
        customerSelection: { all: true },
        appliesOncePerCustomer: discountData.one_per_customer || false,
        customerGets: buildCustomerGets(discountData),
        combinesWith: {
          orderDiscounts: discountData.combines_with_order_discounts || false,
          productDiscounts: discountData.combines_with_product_discounts || false,
          shippingDiscounts: discountData.combines_with_shipping_discounts || false,
        },
        ...(buildMinimumRequirement(discountData) && { minimumRequirement: buildMinimumRequirement(discountData) })
      }
    };

    try {
      const result = await handleGraphQLResponse(await admin.graphql(`
        mutation discountCodeBasicCreate($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  title
                  codes(first: 1) { nodes { code } }
                  status
                }
              }
            }
            userErrors { field message }
          }
        }
      `, { variables }));

      if (!result || !Object.keys(result).length) {
        throw new Error('Empty response from Shopify API - check app permissions and API version');
      }

      if (result.errors) {
        throw new Error(`GraphQL Error: ${result.errors.map((e: any) => e.message).join(', ')}`);
      }

      const userErrors = result.data?.discountCodeBasicCreate?.userErrors;
      if (userErrors?.length) {
        const hasDuplicateCode = userErrors.some((e: any) =>
          e.message.includes('must be unique') || e.message.includes('unique') || e.field?.includes('code')
        );
        if (hasDuplicateCode && retryCount < 3) return createWithRetry(retryCount + 1);
        throw new Error(`Shopify API Error: ${userErrors.map((e: any) => `${e.field}: ${e.message}`).join(', ')}`);
      }

      const discountNode = result.data?.discountCodeBasicCreate?.codeDiscountNode;
      if (!discountNode) throw new Error('No discount node returned from Shopify API.');

      return {
        id: discountNode.id,
        title: discountNode.codeDiscount?.title,
        code: discountNode.codeDiscount?.codes?.nodes?.[0]?.code,
        status: discountNode.codeDiscount?.status
      };
    } catch (error: any) {
      throw new Error(`GraphQL execution failed: ${error.message}`);
    }
  };

  return createWithRetry();
}

async function createBuyXGetYDiscount(admin: any, discountData: CreateDiscountData) {
  if (!discountData.buy_quantity || !discountData.get_quantity) {
    throw new Error("Buy X Get Y discounts require 'buy_quantity' and 'get_quantity' fields");
  }

  const hasSpecificItems = (discountData.product_ids?.length || 0) > 0 || (discountData.collection_ids?.length || 0) > 0;
  if (!hasSpecificItems) {
    throw new Error("Buy X Get Y discounts require specific products or collections. Cannot set to 'all' items.");
  }

  const createWithRetry = async (retryCount = 0): Promise<any> => {
    let discountCode = retryCount > 0 ? generateUniqueCode(discountData.code || '', retryCount) : discountData.code;

    const discountValue = (discountData.get_discount || ImportExportConfig.defaultBuyXGetYDiscount) / 100;
    const customerGets: any = {
      value: { discountOnQuantity: { quantity: discountData.get_quantity!.toString(), effect: { percentage: discountValue } } },
      items: {}
    };
    const customerBuys: any = {
      value: { quantity: discountData.buy_quantity!.toString() },
      items: {}
    };

    if (discountData.product_ids?.length) {
      const uniqueProductIds = [...new Set(discountData.product_ids)];
      const productGids = uniqueProductIds.map(id => `gid://shopify/Product/${id}`);
      customerGets.items = { products: { productsToAdd: productGids } };
      customerBuys.items = { products: { productsToAdd: productGids } };
    } else if (discountData.collection_ids?.length) {
      const uniqueCollectionIds = [...new Set(discountData.collection_ids)];
      const collectionGids = uniqueCollectionIds.map(id => `gid://shopify/Collection/${id}`);
      customerGets.items = { collections: { collectionsToAdd: collectionGids } };
      customerBuys.items = { collections: { collectionsToAdd: collectionGids } };
    } else {
      throw new Error("Buy X Get Y discounts require specific products or collections.");
    }

    const variables = {
      bxgyCodeDiscount: {
        title: discountData.title,
        code: discountCode,
        startsAt: discountData.starts_at?.toISOString() || new Date().toISOString(),
        endsAt: discountData.ends_at?.toISOString() || null,
        usageLimit: discountData.usage_limit || null,
        customerSelection: { all: true },
        appliesOncePerCustomer: discountData.one_per_customer || false,
        customerBuys,
        customerGets,
        combinesWith: {
          orderDiscounts: discountData.combines_with_order_discounts || false,
          productDiscounts: discountData.combines_with_product_discounts || false,
          shippingDiscounts: discountData.combines_with_shipping_discounts || false,
        },
        ...(buildMinimumRequirement(discountData) && { minimumRequirement: buildMinimumRequirement(discountData) })
      }
    };

    try {
      const result = await handleGraphQLResponse(await admin.graphql(`
        mutation discountCodeBxgyCreate($bxgyCodeDiscount: DiscountCodeBxgyInput!) {
          discountCodeBxgyCreate(bxgyCodeDiscount: $bxgyCodeDiscount) {
            codeDiscountNode {
              id
              codeDiscount {
                ... on DiscountCodeBxgy {
                  title
                  codes(first: 1) { nodes { code } }
                  status
                }
              }
            }
            userErrors { field message }
          }
        }
      `, { variables }));

      if (!result || !Object.keys(result).length) {
        throw new Error('Empty response from Shopify API - check app permissions and API version');
      }

      if (result.errors) {
        throw new Error(`GraphQL Error: ${result.errors.map((e: any) => e.message).join(', ')}`);
      }

      const userErrors = result.data?.discountCodeBxgyCreate?.userErrors;
      if (userErrors?.length) {
        const hasDuplicateCode = userErrors.some((e: any) =>
          e.message.includes('must be unique') || e.message.includes('unique') || e.field?.includes('code')
        );
        if (hasDuplicateCode && retryCount < 3) return createWithRetry(retryCount + 1);
        throw new Error(`Shopify API Error: ${userErrors.map((e: any) => `${e.field}: ${e.message}`).join(', ')}`);
      }

      const discountNode = result.data?.discountCodeBxgyCreate?.codeDiscountNode;
      if (!discountNode) throw new Error('No discount node returned from Shopify API for Buy X Get Y discount.');

      return {
        id: discountNode.id,
        title: discountNode.codeDiscount?.title,
        code: discountNode.codeDiscount?.codes?.nodes?.[0]?.code,
        status: discountNode.codeDiscount?.status
      };
    } catch (error: any) {
      throw new Error(`GraphQL execution failed for Buy X Get Y: ${error.message}`);
    }
  };

  return createWithRetry();
}