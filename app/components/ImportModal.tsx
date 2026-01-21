import { Modal, BlockStack, Banner, Text, InlineStack, Button, Spinner, ProgressBar } from "@shopify/polaris";
import { ImportIcon } from "@shopify/polaris-icons";
import { ImportResult } from "../hooks/useImport";
import { useState } from "react";

interface ImportModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    onImport: (formData: FormData) => void;
    onCancel: () => void;
    isImporting: boolean;
    progress: number;
    results: ImportResult | null;
    sampleCsvContent: string;
    sampleCsvName: string;
    entityName: string; // e.g., "companies", "collections"
}

export function ImportModal({
    open,
    onClose,
    title,
    onImport,
    onCancel,
    isImporting,
    progress,
    results,
    sampleCsvContent,
    sampleCsvName,
    entityName
}: ImportModalProps) {
    const [showCancelConfirmation, setShowCancelConfirmation] = useState(false);

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        onImport(formData);
    };

    const handleDownloadSample = () => {
        const blob = new Blob([sampleCsvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = sampleCsvName;
        link.click();
    };

    const handleCloseRequest = () => {
        // Allow closing the modal without cancelling (background import)
        onClose();
    };

    const confirmCancel = () => {
        setShowCancelConfirmation(false);
        onCancel(); // Explicitly cancel the job
    };

    return (
        <>
            <Modal
                open={open}
                onClose={handleCloseRequest}
                title={title}
                primaryAction={
                    !isImporting && !results ? {
                        content: 'Cancel',
                        onAction: onClose
                    } : results ? {
                        content: 'Close',
                        onAction: () => {
                            onClose();
                            window.location.reload();
                        }
                    } : undefined
                }
            >
                <Modal.Section>
                    {!isImporting && !results && (
                        <form onSubmit={handleSubmit}>
                            <BlockStack gap="400">
                                <Banner tone="info">
                                    <Text as="p">Upload a CSV file to import {entityName} into Shopify.</Text>
                                </Banner>

                                <div style={{
                                    border: '2px dashed var(--p-color-border-hover)',
                                    borderRadius: '8px',
                                    padding: '30px',
                                    textAlign: 'center',
                                    background: 'var(--p-color-bg-surface-secondary)'
                                }}>
                                    <input
                                        type="file"
                                        name="csvFile"
                                        accept=".csv"
                                        required
                                        style={{ width: '100%' }}
                                    />
                                </div>

                                <InlineStack align="end" gap="300">
                                    <Button variant="plain" onClick={handleDownloadSample}>
                                        Download Sample CSV
                                    </Button>
                                    <Button submit variant="primary" icon={ImportIcon}>
                                        Start Import
                                    </Button>
                                </InlineStack>
                            </BlockStack>
                        </form>
                    )}

                    {isImporting && (
                        <BlockStack gap="400" inlineAlign="center">
                            <Spinner size="large" />
                            <Text as="h2" variant="headingMd">Importing {entityName}...</Text>
                            <Text as="p" tone="subdued">You can close this tab, the import will continue in the background.</Text>
                            <div style={{ width: '100%' }}>
                                <ProgressBar progress={progress} size="small" tone="primary" />
                            </div>
                            <Text as="p" tone="subdued">{progress}% complete</Text>

                            <Button tone="critical" onClick={() => setShowCancelConfirmation(true)}>
                                Cancel Import
                            </Button>
                        </BlockStack>
                    )}

                    {results && (
                        <BlockStack gap="400">
                            <Banner
                                title={results.successCount > 0 ? "Successfully imported" : "Import failed"}
                                tone={results.successCount > 0 ? "success" : "critical"}
                            >
                                <p>{results.message}</p>
                                {entityName === 'companies' && results.companyCount !== undefined ? (
                                    <>
                                        <p><strong>{results.companyCount}</strong> {results.companyCount === 1 ? 'company' : 'companies'} with <strong>{results.successCount}</strong> {results.successCount === 1 ? 'location' : 'locations'} imported.</p>
                                    </>
                                ) : (
                                    <p><strong>{results.successCount}</strong> {entityName} imported.</p>
                                )}
                                {results.errorCount > 0 && <p>Failed: <strong>{results.errorCount}</strong></p>}
                            </Banner>

                            {/* Show detailed errors and warnings if any exist */}
                            {results.results && (results.results.some(r => r.status === 'error') || results.results.some(r => r.status === 'warning')) && (
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                    <BlockStack gap="200">
                                        {results.results.filter(r => r.status === 'error').length > 0 && (
                                            <>
                                                <Text as="h3" variant="headingSm" tone="critical">Errors:</Text>
                                                {results.results.filter(r => r.status === 'error').map((res, index) => (
                                                    <Text key={`error-${index}`} as="p" tone="critical">
                                                        {res.title}: {res.message}
                                                    </Text>
                                                ))}
                                            </>
                                        )}
                                        {results.results.filter(r => r.status === 'warning').length > 0 && (
                                            <>
                                                <Text as="h3" variant="headingSm" tone="caution">Warnings:</Text>
                                                {results.results.filter(r => r.status === 'warning').map((res, index) => (
                                                    <Text key={`warning-${index}`} as="p" tone="caution">
                                                        {res.title}: {res.message}
                                                    </Text>
                                                ))}
                                            </>
                                        )}
                                    </BlockStack>
                                </div>
                            )}
                        </BlockStack>
                    )}
                </Modal.Section>
            </Modal>

            {/* Cancellation Confirmation Modal */}
            <Modal
                open={showCancelConfirmation}
                onClose={() => setShowCancelConfirmation(false)}
                title="Cancel Import?"
                primaryAction={{
                    content: 'Yes, Cancel Import',
                    onAction: confirmCancel,
                    destructive: true
                }}
                secondaryActions={[{
                    content: 'No, Continue',
                    onAction: () => setShowCancelConfirmation(false)
                }]}
            >
                <Modal.Section>
                    <Text as="p">
                        Are you sure you want to stop the import process? Any records already processed will remain imported.
                    </Text>
                </Modal.Section>
            </Modal>
        </>
    );
}
