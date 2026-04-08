import { Injectable, Scope } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type Schema = "public" | "student" | "grading" | "reporting" | "staff"

@Injectable({ scope: Scope.REQUEST })
export class SupabaseService {
    private serviceClient: SupabaseClient = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    createUserClient(user_token: string, schema: Schema) {
        return createClient(
            process.env.SUPABASE_URL!,
            process.env.PUSHABLE_KEY!,
            {
                global: {
                    headers: {
                        Authorization: `Bearer ${user_token}`
                    }
                },

                db: {
                    schema: schema
                }
            }

        )
    }

    getServiceClient() {
        return this.serviceClient;
    }
}