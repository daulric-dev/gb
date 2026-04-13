export interface CacheInterface {
    get(key: string): Promise<any>;
    set(key: string, value: any, ttl: number): Promise<void>;
    delete(key: string): Promise<void>;
    clear(): Promise<void>;
}