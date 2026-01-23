import { useState, useEffect } from "react";
import { useLoaderData, useNavigation, useSearchParams, useNavigate, useActionData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { Card, DataTable, Layout, Text, BlockStack, Icon, Button, Pagination, Toast, Frame } from "@shopify/polaris";
import { ExportIcon, ImportIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getAllCompanies, getCompanyStats } from "../models/company.server";
import { useImport } from "../hooks/useImport";
import { useExport } from "../hooks/useExport";
import { ImportModal } from "../components/ImportModal";
import { GenericPage } from "../components/GenericPage";

const jsonResponse = (data: any, status = 200) => new Response(
  JSON.stringify(data, (key, value) => typeof value === 'bigint' ? value.toString() : value),
  { status, headers: { "Content-Type": "application/json" } }
);

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  const hasDefinition = await hasMetaobjectDefinition(admin, METAOBJECT_DEFS.COMPANY.type);

  if (!hasDefinition) {
    return jsonResponse({ companies: [], pagination: {}, stats: {}, hasDefinition: false });
  }

  try {
    const [{ companies, pagination }, stats] = await Promise.all([
      getAllCompanies(admin, page),
      getCompanyStats(admin)
    ]);
    return jsonResponse({ companies, pagination, stats, hasDefinition: true });
  } catch (error) {
    console.error("Failed to load companies:", error);
    return jsonResponse({ companies: [], pagination: { page: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false }, stats: {}, hasDefinition: true });
  }
}

export async function action({ request }: LoaderFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("actionType");

  if (actionType === "create_database") {
    await ensureMetaobjectDefinition(admin, METAOBJECT_DEFS.COMPANY);
    return jsonResponse({ success: true, message: "Database created successfully" });
  }
  return null;
}

import { METAOBJECT_DEFS, hasMetaobjectDefinition, ensureMetaobjectDefinition } from "../utils/metaobject.server";
import { EmptyState, Page } from "@shopify/polaris";
import { useSubmit } from "react-router";

export default function CompaniesPage() {
  const { companies, pagination, stats, hasDefinition } = useLoaderData() as { companies: any[]; pagination: any; stats: any; hasDefinition: boolean };
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
  } = useImport('/api/companies/import', 'companies');

  const {
    isExporting,
    exportStatus,
    downloadUrl,
    handleExport,
    resetExport
  } = useExport('/api/companies/export');

  const isCreating = nav.state === "submitting" && nav.formData?.get("actionType") === "create_database";

  // Show success toast when database is created
  useEffect(() => {
    if (actionData?.success && actionData?.message) {
      setShowSuccessToast(true);
      // Reload to show the created database
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



  const rows = companies.map(company => [
    <BlockStack gap="100">
      <Text variant="bodyMd" fontWeight="bold" as="span">{company.name}</Text>
      {company.shipping_city && company.shipping_country && (
        <Text variant="bodySm" tone="subdued" as="span">
          {company.shipping_city}, {company.shipping_country}
        </Text>
      )}
    </BlockStack>,
    <Text as="span" variant="bodyMd" tone="subdued">{company.company_id || 'N/A'}</Text>,
    <Text as="span" tone="subdued">{company.contact_email || 'N/A'}</Text>,
    <Text as="span" tone="subdued">{new Date(company.created_at).toLocaleDateString()}</Text>
  ]);



  return (
    <GenericPage
      title="Companies"
      subtitle="Manage your B2B companies and sync with Shopify"
      loadingTitle="Companies"
      loadingText="Loading Companies..."
      exportStatus={exportStatus}
      downloadUrl={downloadUrl}
      onDismissExport={resetExport}
      entityNameForExport="companies"
      primaryAction={{
        content: 'Import CSV',
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
            <Text as="h3" variant="headingSm" tone="subdued">Total Companies</Text>
            <Text as="p" variant="heading2xl">{stats?.totalCompanies || 0}</Text>
          </BlockStack>
        </Card>
      </Layout.Section>

      <Layout.Section>
        <Card padding="0">
          {companies.length > 0 ? (
            <>
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text']}
                headings={['Company', 'ID', 'Contact', 'Created']}
                rows={rows}
                pagination={{
                  hasNext: pagination.hasNextPage,
                  hasPrevious: pagination.hasPreviousPage,
                  onNext: () => navigate(`?page=${pagination.page + 1}`),
                  onPrevious: () => navigate(`?page=${pagination.page - 1}`)
                }}
              />
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
                <Text as="h2" variant="headingMd">No companies found</Text>
                <Text as="p" tone="subdued" variant="bodyMd">
                  Import your company data to get started with B2B management.
                </Text>
                <Button variant="primary" onClick={() => {
                  resetImport();
                  setIsImportModalOpen(true);
                }}>
                  Import Companies
                </Button>
              </BlockStack>
            </div>
          )}
        </Card>
      </Layout.Section>

      <ImportModal
        open={isImportModalOpen}
        onClose={() => {
          setIsImportModalOpen(false);
          if (importResults) resetImport();
        }}
        onCancel={cancelImport}
        title="Import Companies"
        onImport={handleImport}
        isImporting={isImporting}
        progress={importProgress}
        results={importResults}
        entityName="companies"
        sampleCsvName="companies_sample.csv"
        sampleCsvContent={`name,company_id,contact_email,location_name,address1,city,state,zip,country_code,phone,metafields
Test Company US,CMP-001,test-us@example.com,NY HQ,123 Wall St,New York,NY,10005,United States,+12125550123,custom.key:value
Test Company IN,CMP-002,test-in@example.com,MP Branch,45 Main Road,Dhar,MP,454552,India,+919876543210,custom.key:value
Test Company Multi,CMP-003,test-multi@example.com,Loc 1,100 Multi Way,Multi City,CA,90001,United States,+13105550101,custom.key:value
Test Company Multi,CMP-003,test-multi@example.com,Loc 2,200 Multi Way,Multi City,CA,90002,United States,+13105550102,custom.key:value
Test Company Multi,CMP-003,test-multi@example.com,Loc 3,300 Multi Way,Multi City,CA,90003,United States,+13105550103,custom.key:value`}
        onImportComplete={() => navigate(".", { replace: true })}
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
    </GenericPage >
  );
}