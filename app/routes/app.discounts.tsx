import { useState, useEffect } from "react";
import { useLoaderData, useNavigate, useNavigation, useActionData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Card, Button, Badge, DataTable, Layout, Text, BlockStack, InlineStack, Icon, Pagination, Toast, Frame } from "@shopify/polaris";
import { ExportIcon, ImportIcon, DiscountIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getAllLocalDiscounts } from "../models/Discount.server";
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
  const shop = session.shop.replace(".myshopify.com", "");
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  const hasDefinition = await hasMetaobjectDefinition(admin, METAOBJECT_DEFS.DISCOUNT.type);

  if (!hasDefinition) {
    return Response.json({ discounts: [], pagination: {}, hasDefinition: false, shop });
  }

  try {
    const { discounts, pagination } = await getAllLocalDiscounts(admin, page);
    return Response.json({ discounts, pagination, hasDefinition: true, shop });
  } catch (error) {
    console.error("Failed to load discounts:", error);
    return Response.json({ discounts: [], pagination: { page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }, hasDefinition: true, shop });
  }
}

export async function action({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "create_database") {
    await ensureMetaobjectDefinition(admin, METAOBJECT_DEFS.DISCOUNT);
    return jsonResponse({ success: true, message: "Database created successfully" });
  }
  return null;
}

interface Discount {
  id: string; shopify_id?: string; title: string; description?: string; discount_type: string;
  value?: number; code?: string; buy_quantity?: number; get_quantity?: number; get_discount?: number;
  applies_to?: string; customer_eligibility?: string; minimum_requirement_type?: string;
  minimum_requirement_value?: number; usage_limit?: number; one_per_customer?: boolean;
  combines_with_product_discounts?: boolean; combines_with_order_discounts?: boolean;
  combines_with_shipping_discounts?: boolean; starts_at?: Date; ends_at?: Date;
  product_ids?: string[]; collection_ids?: string[]; status?: string;
  created_at: Date; updated_at: Date;
}

import { METAOBJECT_DEFS, hasMetaobjectDefinition, ensureMetaobjectDefinition } from "../utils/metaobject.server";
import { EmptyState, Page } from "@shopify/polaris";
import { useSubmit } from "react-router";

export default function DiscountsPage() {
  const { discounts, pagination, hasDefinition, shop } = useLoaderData() as { discounts: Discount[]; pagination: any; hasDefinition: boolean; shop: string };
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
  } = useImport('/api/discounts/import', 'discounts');

  const {
    isExporting,
    exportStatus,
    downloadUrl,
    handleExport,
    resetExport
  } = useExport('/api/discounts/export');

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



  const formatDiscountValue = (d: Discount) => {
    if (d.discount_type === 'percentage') return `${d.value}% off`;
    if (d.discount_type === 'fixed_amount') return `$${d.value} off`;
    if (d.discount_type === 'shipping') return 'Free Shipping';
    if (d.discount_type === 'buy_x_get_y') return `Buy ${d.buy_quantity} Get ${d.get_quantity} (${d.get_discount}% off)`;
    return 'Custom Discount';
  };

  const formatAppliesTo = (d: Discount) => {
    if (d.applies_to === 'all') return 'All Products';
    if (d.applies_to === 'specific_products') return `${d.product_ids?.length || 0} Products`;
    if (d.applies_to === 'specific_collections') return `${d.collection_ids?.length || 0} Collections`;
    return 'Specific Items';
  };

  const getDiscountBadge = (discount: Discount) => {
    const isActive = discount.shopify_id && discount.status === 'active';
    const isDraft = !discount.shopify_id && discount.status === 'draft';

    if (isActive) return <Badge tone="success">Active</Badge>;
    if (isDraft) return <Badge tone="info">Draft</Badge>;
    return <Badge tone="critical">Failed</Badge>;
  };

  const rows = discounts.map(discount => [
    <BlockStack gap="100">
      <Text variant="bodyMd" fontWeight="bold" as="span">{discount.title}</Text>
      {discount.description && (
        <Text variant="bodySm" tone="subdued" as="span">
          {discount.description.length > 60 ? `${discount.description.substring(0, 60)}...` : discount.description}
        </Text>
      )}
    </BlockStack>,
    <Text as="span" fontWeight="medium">{formatDiscountValue(discount)}</Text>,
    <Text as="span" tone="subdued">{formatAppliesTo(discount)}</Text>,
    <Text as="span" tone="subdued">{discount.code || 'Automatic'}</Text>,
    <InlineStack gap="200" align="start">
      {getDiscountBadge(discount)}
      {discount.shopify_id && (
        <Button
          size="slim"
          url={`https://admin.shopify.com/store/${shop}/discounts/${discount.shopify_id.split('/').pop()}`}
          external
          icon={DiscountIcon}
        >
          View
        </Button>
      )}
    </InlineStack>
  ]);



  return (
    <GenericPage
      title="Discounts"
      subtitle="Manage your discount codes and automatic discounts"
      loadingTitle="Discounts"
      loadingText="Loading Discounts..."
      exportStatus={exportStatus}
      downloadUrl={downloadUrl}
      onDismissExport={resetExport}
      entityNameForExport="discounts"
      primaryAction={{
        content: 'Create Discount',
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
      <Layout.Section>
        <Card>
          <BlockStack gap="200">
            <Text as="h3" variant="headingSm" tone="subdued">Total Discounts</Text>
            <Text as="p" variant="heading2xl">{pagination.total || 0}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card padding="0">
          {discounts.length > 0 ? (
            <>
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text']}
                headings={['Discount', 'Value', 'Applies to', 'Code', 'Status']}
                rows={rows}
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
                  <Icon source={DiscountIcon} tone="subdued" />
                </div>
                <Text as="h2" variant="headingMd">No discounts yet</Text>
                <Text as="p" tone="subdued" variant="bodyMd">
                  Create discount codes and automatic discounts.
                </Text>
                <Button variant="primary" onClick={() => setIsImportModalOpen(true)}>
                  Create Discount
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
        title="Import Discounts"
        onImport={handleImport}
        isImporting={isImporting}
        progress={importProgress}
        results={importResults}
        entityName="discounts"
        sampleCsvName="discounts_sample.csv"
        sampleCsvContent={`title,description,discount_type,value,code,usage_limit,one_per_customer,combines_with_product_discounts,combines_with_order_discounts,combines_with_shipping_discounts,starts_at,ends_at,applies_to,customer_eligibility,minimum_requirement_type,buy_quantity,get_quantity,get_discount,product_ids,metafields
Test Percentage Discount,15% off all items,percentage,15,SAVE15NOW,100,TRUE,TRUE,TRUE,TRUE,2025-12-01T00:00:00,,all,all,none,,,,,custom.key:value
Test Fixed Amount Discount,Fixed $10 off,fixed_amount,10,GET10OFF,50,FALSE,FALSE,FALSE,TRUE,2025-12-01T00:00:00,2026-01-01T00:00:00,all,all,none,,,,,custom.key:value
Test Free Shipping,Free shipping on all orders,shipping,0,SHIPFREE,200,FALSE,TRUE,TRUE,FALSE,2025-12-01T00:00:00,,all,all,none,,,,,custom.key:value
Buy 2 Get 1 Free,Buy 2 get 1 free on selected products,buy_x_get_y,,BOGO2025,150,TRUE,FALSE,FALSE,FALSE,2025-12-01T00:00:00,,specific_products,all,none,2,1,100,"1234567890,9876543210",custom.key:value`}
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