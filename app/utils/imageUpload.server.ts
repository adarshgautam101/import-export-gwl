// app/utils/imageUpload.server.ts
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export async function uploadImageToShopify(admin: AdminApiContext, file: File): Promise<string | null> {
  try {


    // Convert file to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    const response = await admin.graphql(
      `#graphql
      mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
        stagedUploadsCreate(input: $input) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: [
            {
              filename: file.name,
              mimeType: file.type,
              resource: "COLLECTION_IMAGE",
              fileSize: file.size.toString(),
              httpMethod: "POST"
            }
          ],
        },
      }
    );

    const responseJson = await response.json();


    const stagedTargets = responseJson.data?.stagedUploadsCreate?.stagedTargets;

    if (!stagedTargets || stagedTargets.length === 0) {
      console.error("❌ No staged targets returned");
      return null;
    }

    const target = stagedTargets[0];

    // Upload the file to the staged URL
    const formData = new FormData();
    target.parameters.forEach((param: { name: string; value: string }) => {
      formData.append(param.name, param.value);
    });
    formData.append('file', file);

    const uploadResponse = await fetch(target.url, {
      method: 'POST',
      body: formData,
    });

    if (!uploadResponse.ok) {
      console.error("❌ File upload failed:", uploadResponse.statusText);
      return null;
    }


    return target.resourceUrl;

  } catch (error) {
    console.error("❌ Image upload error:", error);
    return null;
  }
}

// Alternative simpler method for collection image update
export async function updateCollectionImage(admin: AdminApiContext, collectionId: bigint, imageFile: File): Promise<string | null> {
  try {


    // Convert file to base64 for direct upload
    const arrayBuffer = await imageFile.arrayBuffer();
    const base64Image = Buffer.from(arrayBuffer).toString('base64');

    const collectionGid = `gid://shopify/Collection/${collectionId}`;

    const response = await admin.graphql(
      `#graphql
      mutation collectionUpdate($input: CollectionInput!) {
        collectionUpdate(input: $input) {
          collection {
            id
            title
            image {
              url
            }
          }
          userErrors {
            field
            message
          }
        }
      }`,
      {
        variables: {
          input: {
            id: collectionGid,
            image: {
              altText: "Collection image",
              src: `data:${imageFile.type};base64,${base64Image}`
            }
          },
        },
      }
    );

    const responseJson = await response.json();


    if (responseJson.data?.collectionUpdate?.userErrors?.length > 0) {
      console.error("❌ Image update errors:", responseJson.data.collectionUpdate.userErrors);
      return null;
    }

    const imageUrl = responseJson.data?.collectionUpdate?.collection?.image?.url;

    return imageUrl;

  } catch (error) {
    console.error("❌ Collection image update error:", error);
    return null;
  }
}