export interface ImportJob {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    entityType: string;
    totalRecords: number;
    processedRecords: number;
    successCount: number;
    errorCount: number;
    companyCount?: number; // For company imports
    results: any[];
    createdAt: Date;
    updatedAt: Date;
}

class ImportJobManager {
    private jobs: Map<string, ImportJob> = new Map();

    createJob(entityType: string, totalRecords: number): string {
        const id = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const job: ImportJob = {
            id,
            status: 'pending',
            entityType,
            totalRecords,
            processedRecords: 0,
            successCount: 0,
            errorCount: 0,
            results: [],
            createdAt: new Date(),
            updatedAt: new Date()
        };
        this.jobs.set(id, job);
        return id;
    }

    getJob(id: string): ImportJob | undefined {
        return this.jobs.get(id);
    }

    updateProgress(id: string, processed: number, success: number, error: number, newResults: any[] = [], companyCount?: number) {
        const job = this.jobs.get(id);
        if (job) {
            job.processedRecords = processed;
            job.successCount = success;
            job.errorCount = error;
            if (companyCount !== undefined) {
                job.companyCount = companyCount;
            }
            if (newResults.length > 0) {
                job.results = [...job.results, ...newResults];
            }
            job.updatedAt = new Date();

            if (job.status === 'pending') {
                job.status = 'processing';
            }

            if (processed >= job.totalRecords && job.status !== 'cancelled') {
                job.status = 'completed';
            }

            this.jobs.set(id, job);
        }
    }

    completeJob(id: string) {
        const job = this.jobs.get(id);
        if (job && job.status !== 'cancelled') {
            job.status = 'completed';
            job.updatedAt = new Date();
            this.jobs.set(id, job);
        }
    }

    failJob(id: string, error: string) {
        const job = this.jobs.get(id);
        if (job) {
            job.status = 'failed';
            job.results.push({
                title: 'System Error',
                status: 'error',
                message: error
            });
            job.updatedAt = new Date();
            this.jobs.set(id, job);
        }
    }

    cancelJob(id: string) {
        const job = this.jobs.get(id);
        if (job) {
            job.status = 'cancelled';
            job.updatedAt = new Date();
            this.jobs.set(id, job);
        }
    }

    isCancelled(id: string): boolean {
        const job = this.jobs.get(id);
        return job?.status === 'cancelled';
    }
}

// Singleton instance
export const importJobManager = new ImportJobManager();
