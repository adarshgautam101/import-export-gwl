import { METAOBJECT_DEFS, ensureMetaobjectDefinition, createMetaobject, updateMetaobject, getMetaobject, listMetaobjects, generateMetaobjectHandle, getMetaobjectByHandle, countMetaobjects } from "../utils/metaobject.server";
import { ImportExportConfig } from "../config/import-export.config";

export enum CollectionType { manual = 'manual', smart = 'smart' }

export interface SmartCollectionCondition { field: string; relation: string; condition: string; }
export interface SmartCollectionRuleSet { relation: 'ALL' | 'ANY'; conditions: SmartCollectionCondition[]; }

export interface CollectionData {
  id?: number;
  shopify_id?: bigint | null;
  title: string;
  description?: string | null;
  collection_type?: CollectionType;
  handle?: string | null;
  seo_title?: string | null;
  meta_description?: string | null;
  image_url?: string | null;
  product_ids?: string[];
  rule_set?: SmartCollectionRuleSet | null;
  stored_metafields?: string | null;
}

export const getAllLocalCollections = async (admin: any, page = 1, pageSize = 20, collectionType?: 'manual' | 'smart') => {


  const { nodes: collections, pageInfo } = await listMetaobjects(admin, METAOBJECT_DEFS.COLLECTION.type, pageSize);


  const mappedCollections = collections.map((c: any) => ({
    ...c,
    handle: c.collection_handle,
  }));


  const filteredCollections = collectionType
    ? mappedCollections.filter((c: any) => c.collection_type === collectionType)
    : mappedCollections;

  const totalCount = await countMetaobjects(admin, METAOBJECT_DEFS.COLLECTION.type);

  return {
    collections: filteredCollections,
    pagination: {
      page,
      pageSize,
      total: totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
      hasNextPage: pageInfo.hasNextPage,
      hasPreviousPage: false,
      endCursor: pageInfo.endCursor
    },
  };
};

export async function getAllShopifyProducts(admin: any) {
  try {
    const response = await admin.graphql(`
      query GetProductsForCollection {
        products(first: 250) {
          nodes { id title handle featuredImage { url } }
        }
      }
    `);
    return (await response.json()).data?.products?.nodes || [];
  } catch (error) {
    console.error("Failed to fetch products:", error);
    return [];
  }
}

async function withRetry<T>(
  operation: () => Promise<T>,
  checkErrors: (result: T) => string | null,
  maxRetries = ImportExportConfig.maxRetries
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      const result = await operation();
      const errorMsg = checkErrors(result);
      if (!errorMsg) return result;

      if (errorMsg.includes('rate limit') || errorMsg.includes('Throttled')) {
        if (++retries >= maxRetries) throw new Error(`Failed after ${maxRetries} retries: ${errorMsg}`);
        await new Promise(r => setTimeout(r, 2000 * retries));
        continue;
      }
      throw new Error(errorMsg);
    } catch (error) {
      if (retries >= maxRetries) throw error;
      retries++;
      await new Promise(r => setTimeout(r, 2000 * retries));
    }
  }
}

export async function saveCollectionLocally(data: CollectionData, admin: any, options: { preventUpdate?: boolean } = {}): Promise<{ action: 'created' | 'updated'; shopifyId?: bigint; warnings?: string[] }> {
  const warnings: string[] = [];
  const collectionData = {
    title: data.title,
    description: data.description,
    collection_type: data.collection_type || CollectionType.manual,
    collection_handle: data.handle,
    seo_title: data.seo_title,
    meta_description: data.meta_description,
    image_url: data.image_url,
    product_ids: data.product_ids ? JSON.parse(JSON.stringify(data.product_ids)) : null,
    rule_set: data.rule_set ? JSON.parse(JSON.stringify(data.rule_set)) : null,
    shopify_id: data.shopify_id ?? null,
    stored_metafields: data.stored_metafields || null,
    updated_at: new Date(),
  };

  if (data.id) {

    return updateMetaobject(admin, String(data.id), collectionData);
  }

  let newShopifyId = data.shopify_id;
  const collectionHandle = data.handle || generateHandle(data.title);
  let action: 'created' | 'updated' = 'created';

  if (admin && !newShopifyId) {

    try {
      const checkQuery = await admin.graphql(`
        query($handle: String!) {
          collectionByHandle(handle: $handle) {
            id
            title
            handle
          }
        }
      `, { variables: { handle: collectionHandle } });

      const checkResult = await checkQuery.json();
      const match = checkResult.data?.collectionByHandle;

      if (match) {

        if (options.preventUpdate) {
          throw new Error(`Collection "${match.title}" already exists in Shopify.`);
        }
        const idMatch = match.id.match(/\/(\d+)$/);
        if (idMatch?.[1]) {
          newShopifyId = BigInt(idMatch[1]);
          action = 'updated';
        }
      }
    } catch (error: any) {
      if (options.preventUpdate && error.message.includes('already exists')) {
        throw error;
      }
      console.warn('Collection existence check failed:', error.message);
    }


    const input: any = {
      title: data.title,
      descriptionHtml: data.description || '',
      handle: collectionHandle,
    };

    if (data.stored_metafields) {
      try {
        const metafieldsInput = data.stored_metafields.split('|').map(mf => {
          const separatorIndex = mf.indexOf(':');
          if (separatorIndex === -1) {
            warnings.push(`Invalid metafield format. Expected format: "namespace.key:value" (e.g., "custom.color:blue")`);
            return null;
          }

          const keyPart = mf.substring(0, separatorIndex);
          const value = mf.substring(separatorIndex + 1);

          let [namespace, key] = keyPart.split('.');
          if (!key) {

            key = namespace;
            namespace = 'custom';
            warnings.push(`Metafield "${mf}" is missing namespace. Using "custom.${key}:${value}" instead. Please ensure the metafield definition "custom.${key}" exists in your Shopify store.`);
          }

          if (namespace && key && value) {
            return { namespace, key, value, type: "single_line_text_field" };
          }
          warnings.push(`Incomplete metafield data in "${mf}". Skipping this metafield.`);
          return null;
        }).filter(Boolean);

        if (metafieldsInput.length > 0) {
          input.metafields = metafieldsInput;
        } else if (data.stored_metafields.trim()) {
          warnings.push('No valid metafields could be parsed. Collection imported without metafields.');
        }
      } catch (e) {
        console.warn("Failed to parse collection metafields:", e);
        warnings.push('Failed to parse metafields. Collection imported without metafields.');
      }
    }

    if (data.image_url?.trim()) input.image = { altText: data.title, src: data.image_url };

    if (data.collection_type === CollectionType.smart && data.rule_set) {
      input.ruleSet = {
        appliedDisjunctively: data.rule_set.relation === 'ANY',
        rules: data.rule_set.conditions.map(c => ({
          column: mapFieldToColumn(c.field),
          relation: mapRelationToShopify(c.relation),
          condition: c.condition
        }))
      };
    }

    if (newShopifyId) {

      const updateCollection = async (id: string, input: any) => {
        const res = await admin.graphql(
          `mutation collectionUpdate($input: CollectionInput!) {
            collectionUpdate(input: $input) {
              collection { id }
              userErrors { field message }
            }
          }`,
          { variables: { input: { ...input, id: `gid://shopify/Collection/${id}` } } }
        );
        return res.json();
      };


      await withRetry(
        () => updateCollection(String(newShopifyId), input),
        (res: any) => res.data?.collectionUpdate?.userErrors?.map((e: any) => e.message).join(', ') || null
      );
    } else {

      const createCollection = async (input: any) => {
        const res = await admin.graphql(
          `mutation collectionCreate($input: CollectionInput!) {
            collectionCreate(input: $input) {
              collection { id }
              userErrors { field message }
            }
          }`,
          { variables: { input } }
        );
        return res.json();
      };

      try {
        const result = await withRetry(
          () => createCollection(input),
          (res: any) => res.data?.collectionCreate?.userErrors?.map((e: any) => e.message).join(', ') || null
        );
        const idMatch = result.data?.collectionCreate?.collection?.id?.match(/\/(\d+)$/);
        if (idMatch?.[1]) newShopifyId = BigInt(idMatch[1]);
      } catch (e: any) {
        if (e.message.includes('Image') && input.image) {
          delete input.image;
          const result = await withRetry(
            () => createCollection(input),
            (res: any) => res.data?.collectionCreate?.userErrors?.map((e: any) => e.message).join(', ') || null
          );
          const idMatch = result.data?.collectionCreate?.collection?.id?.match(/\/(\d+)$/);
          if (idMatch?.[1]) newShopifyId = BigInt(idMatch[1]);
        } else {
          throw e;
        }
      }
    }

    if (data.collection_type === CollectionType.manual && data.product_ids?.length && newShopifyId) {
      await assignProductsToManualCollection(admin, newShopifyId, data.product_ids);
    }
  }

  if (newShopifyId || !admin) {

    await ensureMetaobjectDefinition(admin, METAOBJECT_DEFS.COLLECTION);

    const metaHandle = generateMetaobjectHandle('col', collectionHandle);
    const existingMeta = await getMetaobjectByHandle(admin, METAOBJECT_DEFS.COLLECTION.type, metaHandle);

    const finalData = {
      ...collectionData,
      collection_handle: collectionHandle,
      shopify_id: newShopifyId ? String(newShopifyId) : null,
    };

    if (existingMeta) {
      if (options.preventUpdate) {
        throw new Error(`Collection "${data.title}" already exists locally.`);
      }
      action = 'updated';
      await updateMetaobject(admin, existingMeta.id, { ...finalData, updated_at: new Date() });
    } else {
      await createMetaobject(admin, METAOBJECT_DEFS.COLLECTION.type, {
        ...finalData,
        created_at: new Date(),
        updated_at: new Date()
      }, metaHandle);
    }

    return { action, shopifyId: newShopifyId || undefined, warnings: warnings.length > 0 ? warnings : undefined };
  }
  throw new Error("Collection operation on Shopify failed completely or timed out.");
}

async function assignProductsToManualCollection(admin: any, shopifyId: bigint, productIds: string[]) {
  const collectionGid = `gid://shopify/Collection/${shopifyId}`;
  const productGids = productIds.map(id => `gid://shopify/Product/${id.toString().trim()}`);
  if (!productGids.length) return;

  try {
    await withRetry(
      async () => {
        const res = await admin.graphql(
          `mutation addProductsToCollection($id: ID!, $productIds: [ID!]!) {
            collectionAddProducts(id: $id, productIds: $productIds) {
              userErrors { message }
            }
          }`,
          { variables: { id: collectionGid, productIds: productGids } }
        );
        return res.json();
      },
      (res: any) => res.data?.collectionAddProducts?.userErrors?.map((e: any) => e.message).join(', ') || null
    );
  } catch (error) {
    console.error("Failed to add products to manual collection:", error);
  }
}

const mapFieldToColumn = (field: string) => ({
  'title': 'TITLE',
  'product_type': 'TYPE',
  'vendor': 'VENDOR',
  'tag': 'TAG',
  'variant_price': 'VARIANT_PRICE',
  'variant_compare_at_price': 'VARIANT_COMPARE_AT_PRICE',
  'variant_weight': 'VARIANT_WEIGHT',
  'variant_inventory': 'VARIANT_INVENTORY',
  'variant_title': 'VARIANT_TITLE',

  'price': 'VARIANT_PRICE',
  'compare_at_price': 'VARIANT_COMPARE_AT_PRICE',
  'inventory_stock': 'VARIANT_INVENTORY'
}[field] || 'TAG');

const mapRelationToShopify = (relation: string) => ({
  'equals': 'EQUALS', 'not_equals': 'NOT_EQUALS', 'greater_than': 'GREATER_THAN',
  'less_than': 'LESS_THAN', 'starts_with': 'STARTS_WITH', 'ends_with': 'ENDS_WITH',
  'contains': 'CONTAINS', 'not_contains': 'NOT_CONTAINS'
}[relation] || 'EQUALS');

const generateHandle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');