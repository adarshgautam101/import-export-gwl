import { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Form, useNavigation, useFetcher, useNavigate } from "react-router";
import {
    Page,
    Layout,
    Card,
    BlockStack,
    Text,
    Button,
    Banner,
    InlineStack,
    Box,
    Divider,
    Badge,
    Toast,
    Frame,
    ResourceList,
    ResourceItem,
    TextField,
    EmptyState,
    Icon,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getMetaobjectDefinitions, MetaobjectDefinition } from "../models/metaobject.server";
import { useState, useEffect, useCallback } from "react";
import { ImportIcon, ExportIcon, SearchIcon } from "@shopify/polaris-icons";
import { useExport } from "../hooks/useExport";
import { useImport } from "../hooks/useImport";
import { ImportModal } from "../components/ImportModal";

export async function loader({ request }: LoaderFunctionArgs) {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop.replace(".myshopify.com", "");
    try {
        const definitions = await getMetaobjectDefinitions(admin);
        return Response.json({ definitions, shop });
    } catch (error) {
        console.error("Failed to load metaobject definitions:", error);
        return Response.json({
            definitions: [],
            shop,
            error: "System is busy processing imports. Please refresh in a few moments."
        });
    }
}

export default function MetaobjectsPage() {
    const { definitions, error, shop } = useLoaderData() as { definitions: MetaobjectDefinition[], error?: string, shop: string };
    const navigation = useNavigation();
    const navigate = useNavigate();

    const [showBanner, setShowBanner] = useState(true);
    const [searchValue, setSearchValue] = useState("");
    const [activeDefinition, setActiveDefinition] = useState<MetaobjectDefinition | null>(null);
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);

    // Reusable hooks
    const {
        isExporting,
        exportStatus,
        downloadUrl,
        handleExport,
        resetExport
    } = useExport('/api/metaobjects/export');

    const {
        isImporting,
        importProgress,
        importResults,
        handleImport,
        resetImport,
        cancelImport,
        jobMetadata
    } = useImport('/api/metaobjects/import', 'metaobjects');

    const handleSearchChange = useCallback((value: string) => setSearchValue(value), []);

    // Auto-open modal if importing (e.g. after reload)
    useEffect(() => {
        if (isImporting) {
            setIsImportModalOpen(true);
        }
    }, [isImporting]);

    // Restore activeDefinition from metadata if available (e.g. after reload)
    useEffect(() => {
        if (jobMetadata && !activeDefinition) {
            setActiveDefinition(jobMetadata);
        }
    }, [jobMetadata, activeDefinition]);

    const filteredDefinitions = definitions.filter((def) =>
        def.name.toLowerCase().includes(searchValue.toLowerCase()) ||
        def.type.toLowerCase().includes(searchValue.toLowerCase())
    );

    const onExportClick = (def: MetaobjectDefinition) => {
        setActiveDefinition(def);
        handleExport('csv', { type: def.type });
    };

    const onImportClick = (def: MetaobjectDefinition) => {
        setActiveDefinition(def);
        resetImport();
        setIsImportModalOpen(true);
    };

    const onImportSubmit = (formData: FormData) => {
        if (activeDefinition) {
            formData.append("type", activeDefinition.type);
            handleImport(formData, activeDefinition);
        }
    };



    const emptyStateMarkup = (
        <EmptyState
            heading="No Metaobject Definitions found"
            action={{
                content: 'Create Metaobject Definition',
                url: `https://admin.shopify.com/store/${shop}/settings/custom_data/metaobjects/create`,
                external: true
            }}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
            <p>Create a Metaobject Definition in your Shopify Admin to get started.</p>
        </EmptyState>
    );

    return (
        <Frame>
            <Page
                fullWidth
                title="Metaobjects Import/Export"
                subtitle="Manage your metaobject data with ease"
            >
                <Layout>
                    {error && (
                        <Layout.Section>
                            <Banner tone="critical" title="Error loading definitions">
                                <p>{error}</p>
                            </Banner>
                        </Layout.Section>
                    )}
                    {/* Export Status Banner */}
                    {(exportStatus || downloadUrl) && (
                        <Layout.Section>
                            <Banner
                                title={downloadUrl ? "Export Ready" : "Exporting Data"}
                                tone={downloadUrl ? "success" : exportStatus?.includes("failed") ? "critical" : "info"}
                                onDismiss={resetExport}
                            >
                                <BlockStack gap="200">
                                    <Text as="p">
                                        {activeDefinition ? `Exporting ${activeDefinition.name}...` : exportStatus}
                                    </Text>
                                    {downloadUrl && (
                                        <Button
                                            url={downloadUrl}
                                            download={`${activeDefinition?.type || 'metaobjects'}-export.csv`}
                                            variant="primary"
                                            icon={ExportIcon} // Using ExportIcon as ArrowDownIcon is not imported yet
                                        >
                                            Download CSV
                                        </Button>
                                    )}
                                </BlockStack>
                            </Banner>
                        </Layout.Section>
                    )}

                    <Layout.Section>
                        <BlockStack gap="500">
                            {showBanner && (
                                <Banner tone="info" onDismiss={() => setShowBanner(false)}>
                                    <p>
                                        <strong>How to use:</strong> Select a Metaobject Definition from the list below to Import or Export data.
                                    </p>
                                </Banner>
                            )}

                            <Card>
                                <ResourceList
                                    resourceName={{ singular: 'definition', plural: 'definitions' }}
                                    items={filteredDefinitions}
                                    renderItem={(def) => {
                                        const { type, name, fieldDefinitions } = def;

                                        return (
                                            <ResourceItem
                                                id={type}
                                                url="#"
                                                accessibilityLabel={`View details for ${name}`}
                                                persistActions
                                            >
                                                <BlockStack gap="200">
                                                    <InlineStack align="space-between" blockAlign="center">
                                                        <BlockStack gap="100">
                                                            <Text variant="headingMd" as="h3">
                                                                {name}
                                                            </Text>
                                                            <Text variant="bodySm" as="span" tone="subdued">
                                                                Type: <Badge tone="info">{type}</Badge>
                                                            </Text>
                                                        </BlockStack>
                                                        <InlineStack gap="200">
                                                            <Button
                                                                icon={ExportIcon}
                                                                onClick={() => onExportClick(def)}
                                                                variant="tertiary"
                                                                disabled={isExporting}
                                                            >
                                                                Export
                                                            </Button>
                                                            <Button
                                                                icon={ImportIcon}
                                                                onClick={() => onImportClick(def)}
                                                                variant="primary"
                                                                disabled={isImporting}
                                                            >
                                                                Import
                                                            </Button>
                                                        </InlineStack>
                                                    </InlineStack>
                                                    <Text variant="bodySm" as="p" tone="subdued">
                                                        {fieldDefinitions.length} fields defined
                                                    </Text>
                                                </BlockStack>
                                            </ResourceItem>
                                        );
                                    }}
                                    emptyState={emptyStateMarkup}
                                    filterControl={
                                        <div style={{ padding: '16px' }}>
                                            <TextField
                                                label="Search Metaobjects"
                                                labelHidden
                                                value={searchValue}
                                                onChange={handleSearchChange}
                                                placeholder="Search by name or type..."
                                                autoComplete="off"
                                                prefix={<Icon source={SearchIcon} />}
                                            />
                                        </div>
                                    }
                                />
                            </Card>
                        </BlockStack>
                    </Layout.Section>
                </Layout>

                {activeDefinition && (
                    <ImportModal
                        open={isImportModalOpen}
                        onClose={() => {
                            setIsImportModalOpen(false);
                            if (importResults) resetImport();
                        }}
                        onCancel={cancelImport}
                        title={`Import ${activeDefinition.name}`}
                        onImport={onImportSubmit}
                        isImporting={isImporting}
                        progress={importProgress}
                        results={importResults}
                        entityName={activeDefinition.name}
                        sampleCsvName={`${activeDefinition.type}_sample.csv`}
                        sampleCsvContent={`handle,status,${activeDefinition.fieldDefinitions.map(f => f.key).join(',')},metafields\nsample-handle,ACTIVE,${activeDefinition.fieldDefinitions.map(() => '').join(',')},custom.key:value`}
                        onImportComplete={() => navigate(".", { replace: true })}
                    />
                )}
            </Page>
        </Frame>
    );
}
