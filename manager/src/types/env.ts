export interface EnvVariable {
  key: string;
  value: string;
  comment?: string;
  is_secret?: boolean;
}

export interface ServiceEnv {
  service: "backend" | "frontend";
  service_id: string;
  path: string;
  variables: EnvVariable[];
}
