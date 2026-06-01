export interface SchoolRole {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CatalogEntry {
  resource: string;
  action: "create" | "read" | "update" | "delete";
  key: string;
  description: string;
}
