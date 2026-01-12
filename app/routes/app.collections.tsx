import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useActionData, useSearchParams } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Card, Button, Badge, DataTable, Layout, Text, BlockStack, InlineStack, Icon, Thumbnail, Pagination, Toast, Frame } from "@shopify/polaris";
import { ExportIcon, ImportIcon, ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getAllLocalCollections, getAllShopifyProducts } from "../models/Collection.server";
import { useImport } from "../hooks/useImport";
import { useExport } from "../hooks/useExport";
import { ImportModal } from "../components/ImportModal";
import { GenericPage } from "../components/GenericPage";

const jsonResponse = (data: any, status = 200) => new Response(
  JSON.stringify(data, (key, value) => typeof value === 'bigint' ? value.toString() : value),
  { status, headers: { "Content-Type": "application/json" } }
);

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const filter = url.searchParams.get("filter") as 'manual' | 'smart' | null;

  const hasDefinition = await hasMetaobjectDefinition(admin, METAOBJECT_DEFS.COLLECTION.type);

  if (!hasDefinition) {
    return Response.json({ collections: [], pagination: {}, products: [], userEmail: "", currentFilter: 'all', hasDefinition: false });
  }

  try {
    const [{ collections, pagination }, products] = await Promise.all([
      getAllLocalCollections(admin, page, 20, filter || undefined),
      getAllShopifyProducts(admin)
    ]);

    const serializedCollections = collections.map((c: any) => ({
      ...c,
      shopify_id: c.shopify_id ? c.shopify_id.toString() : undefined
    }));

    return Response.json({ collections: serializedCollections, pagination, products, userEmail: "admin@gwlsonali.myshopify.com", currentFilter: filter || 'all', hasDefinition: true });
  } catch (error) {
    console.error("Failed to load collections:", error);
    return Response.json({ collections: [], pagination: { page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }, products: [], userEmail: "", currentFilter: 'all', hasDefinition: true });
  }
}

export async function action({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "create_database") {
    await ensureMetaobjectDefinition(admin, METAOBJECT_DEFS.COLLECTION);
    return jsonResponse({ success: true, message: "Database created successfully" });
  }
  return null;
}

interface Collection {
  id: string; shopify_id?: string; title: string; description?: string; handle?: string;
  collection_type: string; relation_type?: string; tags?: string; product_ids?: string;
  image_url?: string; created_at: Date; updated_at: Date;
}

import { METAOBJECT_DEFS, hasMetaobjectDefinition, ensureMetaobjectDefinition } from "../utils/metaobject.server";
import { EmptyState, Page } from "@shopify/polaris";
import { useSubmit, useNavigation } from "react-router";

export default function CollectionsPage() {
  const { collections, pagination, products, userEmail, currentFilter, hasDefinition } = useLoaderData() as { collections: Collection[]; pagination: any; products: any[]; userEmail: string; currentFilter: 'all' | 'manual' | 'smart'; hasDefinition: boolean };
  const [filter, setFilter] = useState<'all' | 'manual' | 'smart'>(currentFilter);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const navigate = useNavigate();
  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData() as { success?: boolean; message?: string } | undefined;

  // Use reusable hooks
  const {
    isImporting,
    importProgress,
    importResults,
    handleImport,
    resetImport,
    cancelImport
  } = useImport('/api/collections/import', 'collections');

  const {
    isExporting,
    exportStatus,
    downloadUrl,
    handleExport,
    resetExport
  } = useExport('/api/collections/export');

  const isCreating = nav.state === "submitting" && nav.formData?.get("actionType") === "create_database";

  // Show success toast when database is created
  useEffect(() => {
    if (actionData?.success && actionData?.message) {
      setShowSuccessToast(true);
      setTimeout(() => navigate(".", { replace: true }), 1500);
    }
  }, [actionData]);

  // Auto-open modal if importing (e.g. after reload)
  useEffect(() => {
    if (isImporting) {
      setIsImportModalOpen(true);
    }
  }, [isImporting]);



  if (hasDefinition === false) {
    return (
      <Page>
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="Database Required"
                action={{
                  content: 'Create Database',
                  onAction: () => submit({ actionType: "create_database" }, { method: "post" }),
                  loading: isCreating
                }}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>A database is required to track your history and enable restore functionality. Please create one to continue.</p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }



  // Handle filter change with URL navigation
  const handleFilterChange = (newFilter: 'all' | 'manual' | 'smart') => {
    setFilter(newFilter);
    const params = new URLSearchParams();
    if (newFilter !== 'all') {
      params.set('filter', newFilter);
    }
    navigate(`?${params.toString()}`);
  };



  return (
    <GenericPage
      title="Collections"
      subtitle="Manage your product collections and sync with Shopify"
      loadingTitle="Collections"
      loadingText="Loading Collections..."
      exportStatus={exportStatus}
      downloadUrl={downloadUrl}
      onDismissExport={resetExport}
      entityNameForExport="collections"
      primaryAction={{
        content: 'Import Collections',
        icon: ImportIcon,
        onAction: () => {
          resetImport();
          setIsImportModalOpen(true);
        },
        disabled: isImporting
      }}
      secondaryActions={[
        {
          content: isExporting ? 'Exporting...' : 'Export CSV',
          icon: ExportIcon,
          onAction: () => handleExport('csv'),
          disabled: isExporting,
          loading: isExporting
        }
      ]}
    >
      {/* Summary Dashboard */}
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">Total Collections</Text>
            <Text as="p" variant="heading2xl">{pagination.total || 0}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card padding="0">
          <div style={{ padding: '16px' }}>
            <InlineStack gap="200" align="start">
              <Button
                pressed={filter === 'all'}
                onClick={() => handleFilterChange('all')}
                variant={filter === 'all' ? 'primary' : 'secondary'}
              >
                All
              </Button>
              <Button
                pressed={filter === 'manual'}
                onClick={() => handleFilterChange('manual')}
                variant={filter === 'manual' ? 'primary' : 'secondary'}
              >
                Manual
              </Button>
              <Button
                pressed={filter === 'smart'}
                onClick={() => handleFilterChange('smart')}
                variant={filter === 'smart' ? 'primary' : 'secondary'}
              >
                Smart
              </Button>
            </InlineStack>
          </div>

          {collections.length > 0 ? (
            <>
              <DataTable
                columnContentTypes={
                  filter === 'all'
                    ? ['text', 'text', 'text', 'text', 'text', 'text']
                    : ['text', 'text', 'text', 'text', 'text']
                }
                headings={
                  filter === 'all'
                    ? ['Image', 'Collection', 'Type', 'Handle', 'Created', 'User Email']
                    : ['Image', 'Collection', 'Handle', 'Created', 'User Email']
                }
                rows={collections.map((collection: Collection) => {
                  const baseRow = [
                    collection.image_url ? (
                      <Thumbnail source={collection.image_url} alt={collection.title} size="small" />
                    ) : (
                      <Thumbnail source={ImageIcon} alt="No image" size="small" />
                    ),
                    <BlockStack gap="100">
                      <Text variant="bodyMd" fontWeight="bold" as="span">{collection.title}</Text>
                      {collection.description && <Text variant="bodySm" tone="subdued" as="span">{collection.description.substring(0, 60)}...</Text>}
                    </BlockStack>
                  ];

                  if (filter === 'all') {
                    baseRow.push(
                      <Badge tone={collection.collection_type === 'smart' ? 'info' : 'success'}>
                        {collection.collection_type === 'smart' ? 'Smart' : 'Manual'}
                      </Badge>
                    );
                  }

                  baseRow.push(
                    <Text as="span" tone="subdued">{collection.handle || 'N/A'}</Text>,
                    <Text as="span" tone="subdued">{new Date(collection.created_at).toLocaleDateString()}</Text>,
                    <Text as="span" tone="subdued">{userEmail || 'N/A'}</Text>
                  );

                  return baseRow;
                })}
                hoverable
              />
              <div style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
                <Pagination
                  hasPrevious={pagination.hasPreviousPage}
                  onPrevious={() => navigate(`?page=${pagination.page - 1}`)}
                  hasNext={pagination.hasNextPage}
                  onNext={() => navigate(`?page=${pagination.page + 1}`)}
                />
              </div>
            </>
          ) : (
            <div style={{ padding: '60px 20px', textAlign: 'center' }}>
              <BlockStack gap="400" inlineAlign="center">
                <div style={{
                  background: 'var(--p-color-bg-surface-secondary)',
                  borderRadius: '50%',
                  padding: '20px',
                  marginBottom: '10px'
                }}>
                  <Icon source={ImportIcon} tone="subdued" />
                </div>
                <Text as="h2" variant="headingMd">No collections found</Text>
                <Text as="p" tone="subdued" variant="bodyMd">
                  Import your collections to get started.
                </Text>
                <Button variant="primary" onClick={() => setIsImportModalOpen(true)}>
                  Import Collections
                </Button>
              </BlockStack>
            </div>
          )}
        </Card>
      </Layout.Section>

      <ImportModal
        open={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onCancel={cancelImport}
        title="Import Collections"
        onImport={handleImport}
        isImporting={isImporting}
        progress={importProgress}
        results={importResults}
        entityName="collections"
        sampleCsvName="collections_sample.csv"
        sampleCsvContent={`title,collection_type,product_ids,relation_type,tags,metafields
Manual Collection,manual,1234567890,,,custom.testcollection:Manual Value
Collection C,smart,,equals,yes,custom.testcollection:Smart Value`}
      />
      {showSuccessToast && (
        <Frame>
          <Toast
            content="Database created successfully"
            onDismiss={() => setShowSuccessToast(false)}
            duration={4500}
          />
        </Frame>
      )}
    </GenericPage>
  );
}