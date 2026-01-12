import { authenticate } from "../shopify.server";

type AdminContext = Awaited<ReturnType<typeof authenticate.admin>>['admin'];

export interface MetaobjectDefinition {
  type: string;
  name: string;
  fieldDefinitions: MetaobjectFieldDefinition[];
}

export interface MetaobjectFieldDefinition {
  key: string;
  name: string;
  type: {
    name: string;
    category: string;
  };
  description: string;
  required: boolean;
}

export async function getMetaobjectDefinitions(admin: AdminContext): Promise<MetaobjectDefinition[]> {
  const response = await admin.graphql(`
    query GetMetaobjectDefinitions {
      metaobjectDefinitions(first: 250) {
        nodes {
          type
          name
          fieldDefinitions {
            key
            name
            type {
              name
              category
            }
            description
            required
          }
        }
      }
    }
  `);

  const json = await response.json();
  return json.data.metaobjectDefinitions.nodes;
}

export async function getMetaobjectDefinitionByType(admin: AdminContext, type: string): Promise<MetaobjectDefinition | null> {
  const response = await admin.graphql(`
    query GetMetaobjectDefinitionByType($type: String!) {
      metaobjectDefinitionByType(type: $type) {
        type
        name
        fieldDefinitions {
          key
          name
          type {
            name
            category
          }
          description
          required
        }
      }
    }
  `, {
    variables: { type }
  });

  const json = await response.json();
  return json.data.metaobjectDefinitionByType;
}

export async function uploadFile(admin: AdminContext, url: string): Promise<string | null> {
  try {
    const response = await admin.graphql(`
      mutation fileCreate($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `, {
      variables: {
        files: [{ originalSource: url }]
      }
    });

    const json = await response.json();
    const file = json.data.fileCreate.files?.[0];

    if (file?.id) {
      return file.id;
    }
    return null;
  } catch (error) {
    console.error("File upload failed:", error);
    return null;
  }
}

export async function resolveReference(admin: AdminContext, type: string, value: string): Promise<string | null> {
  if (value.startsWith("gid://")) return value;

  // Handle common reference types by handle
  let query = "";
  let variables = { handle: value };
  let path = "";

  if (type.includes("product_reference")) {
    query = `query getProduct($handle: String!) { productByHandle(handle: $handle) { id } }`;
    path = "productByHandle.id";
  } else if (type.includes("collection_reference")) {
    query = `query getCollection($handle: String!) { collectionByHandle(handle: $handle) { id } }`;
    path = "collectionByHandle.id";
  } else if (type.includes("page_reference")) {
    query = `query getPage($handle: String!) { pageByHandle(handle: $handle) { id } }`;
    path = "pageByHandle.id";
  } else if (type.includes("blog_reference")) {
    query = `query getBlog($handle: String!) { blogByHandle(handle: $handle) { id } }`;
    path = "blogByHandle.id";
  }
  // Add more types as needed (Article, etc.)

  if (query) {
    try {
      const response = await admin.graphql(query, { variables });
      const json = await response.json();

      // Navigate path
      const parts = path.split('.');
      let current = json.data;
      for (const part of parts) {
        current = current?.[part];
      }
      return current || null;
    } catch (e) {
      console.error(`Failed to resolve reference for ${type} ${value}:`, e);
      return null;
    }
  }

  return null;
}

export async function parseValue(admin: AdminContext, value: string, fieldType: string): Promise<string | any> {
  if (!value) return null;

  const isList = fieldType.startsWith("list.");

  // Handle List Types
  if (isList) {
    // Expecting JSON array or comma/pipe separated
    let items: string[] = [];
    try {
      items = JSON.parse(value);
    } catch {
      items = value.split(/[,|]/).map(s => s.trim());
    }

    // Process each item
    const processedItems = await Promise.all(items.map(async item => {
      // Recursive call for single item type (remove 'list.' prefix)
      // But we need to be careful about the type string. 
      // Simplification: just handle the item logic here or map it.
      const singleType = fieldType.replace("list.", "");
      return parseSingleValue(admin, item, singleType);
    }));

    return JSON.stringify(processedItems.filter(i => i !== null));
  }

  return parseSingleValue(admin, value, fieldType);
}

async function parseSingleValue(admin: AdminContext, value: string, fieldType: string): Promise<string | null> {
  if (fieldType.includes("file_reference")) {
    if (value.startsWith("http")) {
      return await uploadFile(admin, value);
    }
    return value; // Assume GID
  }

  if (fieldType.includes("reference")) {
    return await resolveReference(admin, fieldType, value);
  }

  // Handle Link type
  if (fieldType === "link") {
    try {
      // Check if it's already a JSON object
      JSON.parse(value);
      return value;
    } catch {
      // If not JSON, assume it's a URL string and wrap it
      return JSON.stringify({ url: value, text: value });
    }
  }

  // Handle Rich Text type
  if (fieldType === "rich_text_field") {
    try {
      // Check if it's already a JSON object
      JSON.parse(value);
      return value;
    } catch {
      // If not JSON, wrap simple text in a paragraph
      return JSON.stringify({
        type: "root",
        children: [
          {
            type: "paragraph",
            children: [
              {
                type: "text",
                value: value
              }
            ]
          }
        ]
      });
    }
  }

  // JSON types
  if (fieldType === "json") {
    return value; // Already stringified JSON
  }

  return value;
}
