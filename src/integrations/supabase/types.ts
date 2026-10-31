export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agent_credentials: {
        Row: {
          agent_id: string
          created_at: string
          credential_hash: string
          expires_at: string | null
          id: string
          org_id: string
          replaced_by: string | null
          revoked_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          credential_hash: string
          expires_at?: string | null
          id?: string
          org_id: string
          replaced_by?: string | null
          revoked_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          credential_hash?: string
          expires_at?: string | null
          id?: string
          org_id?: string
          replaced_by?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_credentials_org_id_agent_id_fkey"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "agent_credentials_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_discoveries: {
        Row: {
          agent_id: string
          device_id: string | null
          id: string
          is_read_only_test: boolean
          is_simulated: boolean
          last_reported_at: string
          org_id: string
          payload: Json
          payload_sha256: string | null
          report_count: number
          reported_at: string
          review_flags: Json
          system_serial: string | null
        }
        Insert: {
          agent_id: string
          device_id?: string | null
          id?: string
          is_read_only_test?: boolean
          is_simulated?: boolean
          last_reported_at?: string
          org_id: string
          payload: Json
          payload_sha256?: string | null
          report_count?: number
          reported_at?: string
          review_flags?: Json
          system_serial?: string | null
        }
        Update: {
          agent_id?: string
          device_id?: string | null
          id?: string
          is_read_only_test?: boolean
          is_simulated?: boolean
          last_reported_at?: string
          org_id?: string
          payload?: Json
          payload_sha256?: string | null
          report_count?: number
          reported_at?: string
          review_flags?: Json
          system_serial?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_discoveries_org_id_agent_id_fkey"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "agent_discoveries_org_id_device_id_fkey"
            columns: ["org_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "agent_discoveries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_request_nonces: {
        Row: {
          agent_id: string
          nonce: string
          seen_at: string
        }
        Insert: {
          agent_id: string
          nonce: string
          seen_at?: string
        }
        Update: {
          agent_id?: string
          nonce?: string
          seen_at?: string
        }
        Relationships: []
      }
      agents: {
        Row: {
          agent_version: string | null
          created_at: string
          credential_prefix: string
          enrolled_at: string
          enrollment_token_id: string | null
          hostname: string | null
          id: string
          inventory_requested_at: string | null
          is_simulated: boolean
          last_heartbeat_at: string | null
          last_state: string | null
          name: string
          org_id: string
          platform: string | null
          read_only: boolean
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          site_id: string | null
          status: Database["public"]["Enums"]["agent_status"]
        }
        Insert: {
          agent_version?: string | null
          created_at?: string
          credential_prefix: string
          enrolled_at?: string
          enrollment_token_id?: string | null
          hostname?: string | null
          id?: string
          inventory_requested_at?: string | null
          is_simulated?: boolean
          last_heartbeat_at?: string | null
          last_state?: string | null
          name: string
          org_id: string
          platform?: string | null
          read_only?: boolean
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
        }
        Update: {
          agent_version?: string | null
          created_at?: string
          credential_prefix?: string
          enrolled_at?: string
          enrollment_token_id?: string | null
          hostname?: string | null
          id?: string
          inventory_requested_at?: string | null
          is_simulated?: boolean
          last_heartbeat_at?: string | null
          last_state?: string | null
          name?: string
          org_id?: string
          platform?: string | null
          read_only?: boolean
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          site_id?: string | null
          status?: Database["public"]["Enums"]["agent_status"]
        }
        Relationships: [
          {
            foreignKeyName: "agents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agents_org_id_site_id_fkey"
            columns: ["org_id", "site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json
          entity_id: string | null
          entity_type: string
          id: number
          org_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type: string
          id?: never
          org_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json
          entity_id?: string | null
          entity_type?: string
          id?: never
          org_id?: string | null
        }
        Relationships: []
      }
      batches: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          project_id: string
          status: Database["public"]["Enums"]["batch_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          project_id: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          project_id?: string
          status?: Database["public"]["Enums"]["batch_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "batches_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "batches_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      client_access_grants: {
        Row: {
          created_at: string
          granted_by: string
          id: string
          org_id: string
          project_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string
          id?: string
          org_id: string
          project_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          id?: string
          org_id?: string
          project_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_access_grants_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_access_grants_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "client_access_grants_org_id_user_id_fkey"
            columns: ["org_id", "user_id"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
        ]
      }
      clients: {
        Row: {
          contact_email: string | null
          contact_name: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          org_id: string
          updated_at: string
        }
        Insert: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          org_id: string
          updated_at?: string
        }
        Update: {
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      custody_events: {
        Row: {
          actor_id: string | null
          device_id: string
          event_type: Database["public"]["Enums"]["custody_event_type"]
          from_value: string | null
          id: string
          notes: string | null
          occurred_at: string
          org_id: string
          to_value: string | null
        }
        Insert: {
          actor_id?: string | null
          device_id: string
          event_type: Database["public"]["Enums"]["custody_event_type"]
          from_value?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          org_id: string
          to_value?: string | null
        }
        Update: {
          actor_id?: string | null
          device_id?: string
          event_type?: Database["public"]["Enums"]["custody_event_type"]
          from_value?: string | null
          id?: string
          notes?: string | null
          occurred_at?: string
          org_id?: string
          to_value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custody_events_org_id_device_id_fkey"
            columns: ["org_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "custody_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      device_drive_associations: {
        Row: {
          attached_at: string
          attached_by: string | null
          detached_at: string | null
          detached_by: string | null
          device_id: string
          drive_id: string
          id: string
          org_id: string
          slot: string | null
        }
        Insert: {
          attached_at?: string
          attached_by?: string | null
          detached_at?: string | null
          detached_by?: string | null
          device_id: string
          drive_id: string
          id?: string
          org_id: string
          slot?: string | null
        }
        Update: {
          attached_at?: string
          attached_by?: string | null
          detached_at?: string | null
          detached_by?: string | null
          device_id?: string
          drive_id?: string
          id?: string
          org_id?: string
          slot?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "device_drive_associations_org_id_device_id_fkey"
            columns: ["org_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "device_drive_associations_org_id_drive_id_fkey"
            columns: ["org_id", "drive_id"]
            isOneToOne: false
            referencedRelation: "drives"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "device_drive_associations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          asset_tag: string
          assigned_technician: string | null
          batch_id: string | null
          battery_health_pct: number | null
          battery_notes: string | null
          client_id: string | null
          cpu: string | null
          created_at: string
          created_by: string | null
          diagnostic_notes: string | null
          hardware_verified: boolean
          id: string
          intake_condition: Database["public"]["Enums"]["intake_condition"]
          is_demo: boolean
          is_simulated: boolean
          manufacturer: string | null
          model: string | null
          notes: string | null
          org_id: string
          project_id: string | null
          ram_gb: number | null
          received_at: string
          site_id: string | null
          source: Database["public"]["Enums"]["record_source"]
          status: Database["public"]["Enums"]["device_status"]
          system_serial: string | null
          updated_at: string
        }
        Insert: {
          asset_tag: string
          assigned_technician?: string | null
          batch_id?: string | null
          battery_health_pct?: number | null
          battery_notes?: string | null
          client_id?: string | null
          cpu?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic_notes?: string | null
          hardware_verified?: boolean
          id?: string
          intake_condition?: Database["public"]["Enums"]["intake_condition"]
          is_demo?: boolean
          is_simulated?: boolean
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          org_id: string
          project_id?: string | null
          ram_gb?: number | null
          received_at?: string
          site_id?: string | null
          source?: Database["public"]["Enums"]["record_source"]
          status?: Database["public"]["Enums"]["device_status"]
          system_serial?: string | null
          updated_at?: string
        }
        Update: {
          asset_tag?: string
          assigned_technician?: string | null
          batch_id?: string | null
          battery_health_pct?: number | null
          battery_notes?: string | null
          client_id?: string | null
          cpu?: string | null
          created_at?: string
          created_by?: string | null
          diagnostic_notes?: string | null
          hardware_verified?: boolean
          id?: string
          intake_condition?: Database["public"]["Enums"]["intake_condition"]
          is_demo?: boolean
          is_simulated?: boolean
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          org_id?: string
          project_id?: string | null
          ram_gb?: number | null
          received_at?: string
          site_id?: string | null
          source?: Database["public"]["Enums"]["record_source"]
          status?: Database["public"]["Enums"]["device_status"]
          system_serial?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_org_id_assigned_technician_fkey"
            columns: ["org_id", "assigned_technician"]
            isOneToOne: false
            referencedRelation: "memberships"
            referencedColumns: ["org_id", "user_id"]
          },
          {
            foreignKeyName: "devices_org_id_batch_id_fkey"
            columns: ["org_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "devices_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "devices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "devices_org_id_site_id_fkey"
            columns: ["org_id", "site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      drives: {
        Row: {
          capacity_bytes: number | null
          created_at: string
          firmware_version: string | null
          hardware_verified: boolean
          id: string
          interface: Database["public"]["Enums"]["drive_interface"]
          is_simulated: boolean
          manufacturer: string | null
          model: string | null
          notes: string | null
          org_id: string
          serial: string
          source: Database["public"]["Enums"]["record_source"]
          updated_at: string
        }
        Insert: {
          capacity_bytes?: number | null
          created_at?: string
          firmware_version?: string | null
          hardware_verified?: boolean
          id?: string
          interface: Database["public"]["Enums"]["drive_interface"]
          is_simulated?: boolean
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          org_id: string
          serial: string
          source?: Database["public"]["Enums"]["record_source"]
          updated_at?: string
        }
        Update: {
          capacity_bytes?: number | null
          created_at?: string
          firmware_version?: string | null
          hardware_verified?: boolean
          id?: string
          interface?: Database["public"]["Enums"]["drive_interface"]
          is_simulated?: boolean
          manufacturer?: string | null
          model?: string | null
          notes?: string | null
          org_id?: string
          serial?: string
          source?: Database["public"]["Enums"]["record_source"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drives_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrollment_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          is_simulated: boolean
          label: string
          org_id: string
          read_only: boolean
          revoked_at: string | null
          site_id: string | null
          token_hash: string
          used_at: string | null
          used_by_agent: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          is_simulated?: boolean
          label: string
          org_id: string
          read_only?: boolean
          revoked_at?: string | null
          site_id?: string | null
          token_hash: string
          used_at?: string | null
          used_by_agent?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          is_simulated?: boolean
          label?: string
          org_id?: string
          read_only?: boolean
          revoked_at?: string | null
          site_id?: string | null
          token_hash?: string
          used_at?: string | null
          used_by_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enrollment_tokens_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrollment_tokens_org_id_site_id_fkey"
            columns: ["org_id", "site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      evidence_objects: {
        Row: {
          agent_id: string | null
          content: string
          content_type: string
          created_at: string
          filename: string
          id: string
          idempotency_key: string
          is_simulated: boolean
          job_id: string
          kind: string
          org_id: string
          sha256: string
          size_bytes: number
        }
        Insert: {
          agent_id?: string | null
          content: string
          content_type?: string
          created_at?: string
          filename: string
          id?: string
          idempotency_key: string
          is_simulated?: boolean
          job_id: string
          kind: string
          org_id: string
          sha256: string
          size_bytes: number
        }
        Update: {
          agent_id?: string | null
          content?: string
          content_type?: string
          created_at?: string
          filename?: string
          id?: string
          idempotency_key?: string
          is_simulated?: boolean
          job_id?: string
          kind?: string
          org_id?: string
          sha256?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "evidence_objects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evidence_objects_org_id_job_id_fkey"
            columns: ["org_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      job_authorizations: {
        Row: {
          agent_id: string
          association_id: string
          authorized_at: string
          authorized_by: string
          confirmed_asset_tag: string
          confirmed_drive_serial: string
          consumed_at: string | null
          device_id: string
          drive_id: string
          expires_at: string
          id: string
          job_id: string
          local_confirmation: Json | null
          local_confirmation_required: boolean
          org_id: string
          policy_version_id: string
          revoke_reason: string | null
          revoked_at: string | null
        }
        Insert: {
          agent_id: string
          association_id: string
          authorized_at?: string
          authorized_by: string
          confirmed_asset_tag: string
          confirmed_drive_serial: string
          consumed_at?: string | null
          device_id: string
          drive_id: string
          expires_at: string
          id?: string
          job_id: string
          local_confirmation?: Json | null
          local_confirmation_required?: boolean
          org_id: string
          policy_version_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
        }
        Update: {
          agent_id?: string
          association_id?: string
          authorized_at?: string
          authorized_by?: string
          confirmed_asset_tag?: string
          confirmed_drive_serial?: string
          consumed_at?: string | null
          device_id?: string
          drive_id?: string
          expires_at?: string
          id?: string
          job_id?: string
          local_confirmation?: Json | null
          local_confirmation_required?: boolean
          org_id?: string
          policy_version_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_authorizations_org_id_agent_id_fkey"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "job_authorizations_org_id_association_id_fkey"
            columns: ["org_id", "association_id"]
            isOneToOne: false
            referencedRelation: "device_drive_associations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "job_authorizations_org_id_device_id_fkey"
            columns: ["org_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "job_authorizations_org_id_drive_id_fkey"
            columns: ["org_id", "drive_id"]
            isOneToOne: false
            referencedRelation: "drives"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "job_authorizations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_authorizations_org_id_job_id_fkey"
            columns: ["org_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "job_authorizations_org_id_policy_version_id_fkey"
            columns: ["org_id", "policy_version_id"]
            isOneToOne: false
            referencedRelation: "policy_versions"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      job_events: {
        Row: {
          actor_id: string | null
          agent_id: string | null
          agent_seq: number | null
          event_type: string
          from_status: Database["public"]["Enums"]["job_status"] | null
          id: number
          idempotency_key: string | null
          job_id: string
          message: string | null
          occurred_at: string | null
          org_id: string
          payload: Json
          received_at: string
          request_hash: string | null
          response: Json | null
          source: string
          to_status: Database["public"]["Enums"]["job_status"] | null
        }
        Insert: {
          actor_id?: string | null
          agent_id?: string | null
          agent_seq?: number | null
          event_type: string
          from_status?: Database["public"]["Enums"]["job_status"] | null
          id?: never
          idempotency_key?: string | null
          job_id: string
          message?: string | null
          occurred_at?: string | null
          org_id: string
          payload?: Json
          received_at?: string
          request_hash?: string | null
          response?: Json | null
          source: string
          to_status?: Database["public"]["Enums"]["job_status"] | null
        }
        Update: {
          actor_id?: string | null
          agent_id?: string | null
          agent_seq?: number | null
          event_type?: string
          from_status?: Database["public"]["Enums"]["job_status"] | null
          id?: never
          idempotency_key?: string | null
          job_id?: string
          message?: string | null
          occurred_at?: string | null
          org_id?: string
          payload?: Json
          received_at?: string
          request_hash?: string | null
          response?: Json | null
          source?: string
          to_status?: Database["public"]["Enums"]["job_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "job_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_events_org_id_job_id_fkey"
            columns: ["org_id", "job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      jobs: {
        Row: {
          agent_id: string | null
          association_id: string
          billable_unit: boolean | null
          certificate_eligible: boolean | null
          created_at: string
          created_by: string | null
          current_phase: string | null
          device_id: string
          drive_id: string
          exception_code: string | null
          exception_detail: string | null
          execution_detail: Json | null
          execution_finished_at: string | null
          execution_outcome: Database["public"]["Enums"]["execution_outcome"]
          finished_at: string | null
          id: string
          is_simulated: boolean
          job_number: number
          last_agent_seq: number
          last_event_at: string | null
          method: Database["public"]["Enums"]["erasure_method"] | null
          org_id: string
          policy_version_id: string
          progress_measured: boolean
          progress_pct: number | null
          review_decision: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          target_asset_tag: string
          target_drive_capacity_bytes: number | null
          target_drive_interface: Database["public"]["Enums"]["drive_interface"]
          target_drive_model: string | null
          target_drive_serial: string
          target_system_serial: string | null
          updated_at: string
          verification_detail: Json | null
          verification_finished_at: string | null
          verification_outcome: Database["public"]["Enums"]["verification_outcome"]
        }
        Insert: {
          agent_id?: string | null
          association_id: string
          billable_unit?: boolean | null
          certificate_eligible?: boolean | null
          created_at?: string
          created_by?: string | null
          current_phase?: string | null
          device_id: string
          drive_id: string
          exception_code?: string | null
          exception_detail?: string | null
          execution_detail?: Json | null
          execution_finished_at?: string | null
          execution_outcome?: Database["public"]["Enums"]["execution_outcome"]
          finished_at?: string | null
          id?: string
          is_simulated?: boolean
          job_number?: never
          last_agent_seq?: number
          last_event_at?: string | null
          method?: Database["public"]["Enums"]["erasure_method"] | null
          org_id: string
          policy_version_id: string
          progress_measured?: boolean
          progress_pct?: number | null
          review_decision?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_asset_tag: string
          target_drive_capacity_bytes?: number | null
          target_drive_interface: Database["public"]["Enums"]["drive_interface"]
          target_drive_model?: string | null
          target_drive_serial: string
          target_system_serial?: string | null
          updated_at?: string
          verification_detail?: Json | null
          verification_finished_at?: string | null
          verification_outcome?: Database["public"]["Enums"]["verification_outcome"]
        }
        Update: {
          agent_id?: string | null
          association_id?: string
          billable_unit?: boolean | null
          certificate_eligible?: boolean | null
          created_at?: string
          created_by?: string | null
          current_phase?: string | null
          device_id?: string
          drive_id?: string
          exception_code?: string | null
          exception_detail?: string | null
          execution_detail?: Json | null
          execution_finished_at?: string | null
          execution_outcome?: Database["public"]["Enums"]["execution_outcome"]
          finished_at?: string | null
          id?: string
          is_simulated?: boolean
          job_number?: never
          last_agent_seq?: number
          last_event_at?: string | null
          method?: Database["public"]["Enums"]["erasure_method"] | null
          org_id?: string
          policy_version_id?: string
          progress_measured?: boolean
          progress_pct?: number | null
          review_decision?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          target_asset_tag?: string
          target_drive_capacity_bytes?: number | null
          target_drive_interface?: Database["public"]["Enums"]["drive_interface"]
          target_drive_model?: string | null
          target_drive_serial?: string
          target_system_serial?: string | null
          updated_at?: string
          verification_detail?: Json | null
          verification_finished_at?: string | null
          verification_outcome?: Database["public"]["Enums"]["verification_outcome"]
        }
        Relationships: [
          {
            foreignKeyName: "jobs_org_id_agent_id_fkey"
            columns: ["org_id", "agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "jobs_org_id_association_id_fkey"
            columns: ["org_id", "association_id"]
            isOneToOne: false
            referencedRelation: "device_drive_associations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "jobs_org_id_device_id_fkey"
            columns: ["org_id", "device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "jobs_org_id_drive_id_fkey"
            columns: ["org_id", "drive_id"]
            isOneToOne: false
            referencedRelation: "drives"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "jobs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jobs_org_id_policy_version_id_fkey"
            columns: ["org_id", "policy_version_id"]
            isOneToOne: false
            referencedRelation: "policy_versions"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          revoked_at: string | null
          role: Database["public"]["Enums"]["org_role"]
          status: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          revoked_at?: string | null
          role: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          revoked_at?: string | null
          role?: Database["public"]["Enums"]["org_role"]
          status?: Database["public"]["Enums"]["membership_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          brand_display_name: string | null
          created_at: string
          created_by: string | null
          evidence_retention_days: number
          id: string
          is_demo: boolean
          name: string
          slug: string
          status: Database["public"]["Enums"]["org_status"]
          updated_at: string
        }
        Insert: {
          brand_display_name?: string | null
          created_at?: string
          created_by?: string | null
          evidence_retention_days?: number
          id?: string
          is_demo?: boolean
          name: string
          slug: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Update: {
          brand_display_name?: string | null
          created_at?: string
          created_by?: string | null
          evidence_retention_days?: number
          id?: string
          is_demo?: boolean
          name?: string
          slug?: string
          status?: Database["public"]["Enums"]["org_status"]
          updated_at?: string
        }
        Relationships: []
      }
      pilot_requests: {
        Row: {
          business_type: string | null
          company: string
          contact_name: string
          created_at: string
          email: string
          id: string
          message: string | null
          monthly_volume: string | null
        }
        Insert: {
          business_type?: string | null
          company: string
          contact_name: string
          created_at?: string
          email: string
          id?: string
          message?: string | null
          monthly_volume?: string | null
        }
        Update: {
          business_type?: string | null
          company?: string
          contact_name?: string
          created_at?: string
          email?: string
          id?: string
          message?: string | null
          monthly_volume?: string | null
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "platform_admins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      policies: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          is_simulator: boolean
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_simulator?: boolean
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          is_simulator?: boolean
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      policy_versions: {
        Row: {
          allowed_interfaces: Database["public"]["Enums"]["drive_interface"][]
          allowed_manufacturers: string[]
          allowed_methods: Database["public"]["Enums"]["erasure_method"][]
          authorization_ttl_minutes: number
          change_note: string | null
          created_at: string
          created_by: string | null
          id: string
          on_execution_failure: Database["public"]["Enums"]["failure_action"]
          on_verification_failure: Database["public"]["Enums"]["failure_action"]
          org_id: string
          policy_id: string
          require_evidence: boolean
          require_separate_reviewer: boolean
          reviewer_roles: Database["public"]["Enums"]["org_role"][]
          verification_method: string
          verification_sample_pct: number | null
          version: number
        }
        Insert: {
          allowed_interfaces: Database["public"]["Enums"]["drive_interface"][]
          allowed_manufacturers: string[]
          allowed_methods: Database["public"]["Enums"]["erasure_method"][]
          authorization_ttl_minutes?: number
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          on_execution_failure?: Database["public"]["Enums"]["failure_action"]
          on_verification_failure?: Database["public"]["Enums"]["failure_action"]
          org_id: string
          policy_id: string
          require_evidence?: boolean
          require_separate_reviewer?: boolean
          reviewer_roles: Database["public"]["Enums"]["org_role"][]
          verification_method: string
          verification_sample_pct?: number | null
          version: number
        }
        Update: {
          allowed_interfaces?: Database["public"]["Enums"]["drive_interface"][]
          allowed_manufacturers?: string[]
          allowed_methods?: Database["public"]["Enums"]["erasure_method"][]
          authorization_ttl_minutes?: number
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          on_execution_failure?: Database["public"]["Enums"]["failure_action"]
          on_verification_failure?: Database["public"]["Enums"]["failure_action"]
          org_id?: string
          policy_id?: string
          require_evidence?: boolean
          require_separate_reviewer?: boolean
          reviewer_roles?: Database["public"]["Enums"]["org_role"][]
          verification_method?: string
          verification_sample_pct?: number | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "policy_versions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "policy_versions_org_id_policy_id_fkey"
            columns: ["org_id", "policy_id"]
            isOneToOne: false
            referencedRelation: "policies"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          client_id: string
          created_at: string
          due_on: string | null
          expected_device_count: number | null
          id: string
          name: string
          notes: string | null
          org_id: string
          reference: string | null
          site_id: string | null
          starts_on: string | null
          status: Database["public"]["Enums"]["project_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          created_at?: string
          due_on?: string | null
          expected_device_count?: number | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          reference?: string | null
          site_id?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          due_on?: string | null
          expected_device_count?: number | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          reference?: string | null
          site_id?: string | null
          starts_on?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_org_id_client_id_fkey"
            columns: ["org_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "projects_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_org_id_site_id_fkey"
            columns: ["org_id", "site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string | null
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          org_id: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          org_id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          org_id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sites_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      batch_device_counts: {
        Row: {
          batch_id: string | null
          org_id: string | null
          processed: number | null
          quarantined: number | null
          received: number | null
          released: number | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_org_id_batch_id_fkey"
            columns: ["org_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "devices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_device_counts: {
        Row: {
          org_id: string | null
          processed: number | null
          project_id: string | null
          quarantined: number | null
          received: number | null
          released: number | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "devices_org_id_project_id_fkey"
            columns: ["org_id", "project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
    }
    Functions: {
      _insert_policy_version: {
        Args: {
          _note: string
          _org: string
          _policy: string
          _rules: Json
          _version: number
        }
        Returns: string
      }
      _log_job_event: {
        Args: {
          _actor: string
          _agent: string
          _from: Database["public"]["Enums"]["job_status"]
          _job: string
          _message: string
          _org: string
          _payload: Json
          _source: string
          _to: Database["public"]["Enums"]["job_status"]
          _type: string
        }
        Returns: number
      }
      _policy_support_reason: {
        Args: {
          _iface: Database["public"]["Enums"]["drive_interface"]
          _mfr: string
          _pv: Database["public"]["Tables"]["policy_versions"]["Row"]
        }
        Returns: string
      }
      _revoke_agent: {
        Args: { _actor: string; _agent: string; _reason: string }
        Returns: undefined
      }
      _sweep_jobs: { Args: { _org: string }; Returns: number }
      _sync_device_after_job: { Args: { _job: string }; Returns: undefined }
      accept_invitation: { Args: { _token: string }; Returns: string }
      agent_authenticate: {
        Args: { _credential: string; _nonce: string; _timestamp: string }
        Returns: Json
      }
      agent_enroll: {
        Args: {
          _hostname: string
          _name: string
          _platform: string
          _token: string
          _version: string
        }
        Returns: Json
      }
      agent_heartbeat: {
        Args: { _agent: string; _state: string; _version: string }
        Returns: Json
      }
      agent_job_event: {
        Args: {
          _agent: string
          _idem: string
          _job: string
          _occurred_at: string
          _payload: Json
          _seq: number
          _type: string
        }
        Returns: Json
      }
      agent_list_jobs: { Args: { _agent: string }; Returns: Json }
      agent_reconcile: { Args: { _agent: string; _jobs: Json }; Returns: Json }
      agent_report_inventory: {
        Args: { _agent: string; _payload: Json }
        Returns: Json
      }
      agent_rotate_credential: {
        Args: { _agent: string; _credential_id: string }
        Returns: Json
      }
      agent_upload_evidence: {
        Args: {
          _agent: string
          _content: string
          _content_type: string
          _filename: string
          _idem: string
          _job: string
          _kind: string
          _sha256: string
        }
        Returns: Json
      }
      authorize_job: {
        Args: {
          _agent: string
          _confirm_asset_tag: string
          _confirm_drive_serial: string
          _job: string
        }
        Returns: string
      }
      cancel_job: {
        Args: { _job: string; _reason: string }
        Returns: undefined
      }
      create_device_from_discovery: {
        Args: { _asset_tag: string; _discovery: string }
        Returns: string
      }
      create_enrollment_token: {
        Args: {
          _label: string
          _org: string
          _site: string
          _ttl_hours: number
        }
        Returns: string
      }
      create_invitation: {
        Args: {
          _email: string
          _org: string
          _role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      create_job: {
        Args: { _device: string; _drive: string; _policy: string }
        Returns: string
      }
      create_organization: {
        Args: { _name: string; _slug: string }
        Returns: string
      }
      create_policy: {
        Args: {
          _description: string
          _name: string
          _org: string
          _rules: Json
        }
        Returns: string
      }
      create_policy_version: {
        Args: { _note: string; _policy: string; _rules: Json }
        Returns: string
      }
      current_aal: { Args: never; Returns: string }
      device_all_drives_approved: {
        Args: { _device: string }
        Returns: boolean
      }
      has_client_grant: { Args: { _client: string }; Returns: boolean }
      has_org_role: {
        Args: {
          _org: string
          _roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      has_project_grant: { Args: { _project: string }; Returns: boolean }
      is_org_member: { Args: { _org: string }; Returns: boolean }
      is_org_staff: { Args: { _org: string }; Returns: boolean }
      is_platform_admin: { Args: never; Returns: boolean }
      is_untrusted_caller: { Args: never; Returns: boolean }
      job_is_terminal: {
        Args: { _s: Database["public"]["Enums"]["job_status"] }
        Returns: boolean
      }
      job_transition_allowed: {
        Args: {
          _from: Database["public"]["Enums"]["job_status"]
          _to: Database["public"]["Enums"]["job_status"]
        }
        Returns: boolean
      }
      manufacturer_allowed: {
        Args: { _allowed: string[]; _mfr: string }
        Returns: boolean
      }
      method_fits_interface: {
        Args: {
          _i: Database["public"]["Enums"]["drive_interface"]
          _m: Database["public"]["Enums"]["erasure_method"]
        }
        Returns: boolean
      }
      preview_invitation: {
        Args: { _token: string }
        Returns: {
          email: string
          expired: boolean
          org_name: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      review_job: {
        Args: { _approve: boolean; _job: string; _notes: string }
        Returns: undefined
      }
      revoke_agent: {
        Args: { _agent: string; _reason: string }
        Returns: undefined
      }
      revoke_enrollment_token: { Args: { _token: string }; Returns: undefined }
      revoke_invitation: { Args: { _invitation: string }; Returns: undefined }
      revoke_member: { Args: { _membership: string }; Returns: undefined }
      set_policy_archived: {
        Args: { _archived: boolean; _policy: string }
        Returns: undefined
      }
      shares_org_with: { Args: { _user: string }; Returns: boolean }
      simulator_prepare: {
        Args: { _org: string; _scenario: string }
        Returns: Json
      }
      submit_job: { Args: { _job: string }; Returns: undefined }
      sweep_jobs: { Args: { _org: string }; Returns: number }
      update_member_role: {
        Args: {
          _membership: string
          _role: Database["public"]["Enums"]["org_role"]
        }
        Returns: undefined
      }
    }
    Enums: {
      agent_status: "active" | "revoked"
      batch_status: "open" | "processing" | "closed"
      custody_event_type:
        | "received"
        | "moved"
        | "assigned"
        | "status_changed"
        | "quarantined"
        | "released"
        | "drive_attached"
        | "drive_detached"
        | "note"
      device_status:
        | "received"
        | "awaiting_processing"
        | "in_processing"
        | "quarantined"
        | "processed"
        | "released"
        | "referred_manual"
      drive_interface:
        | "sata_hdd"
        | "sata_ssd"
        | "nvme_ssd"
        | "unsupported_other"
      erasure_method:
        | "nvme_sanitize_crypto"
        | "nvme_sanitize_block"
        | "nvme_format_crypto"
        | "ata_sanitize_crypto"
        | "ata_sanitize_block"
        | "ata_enhanced_secure_erase"
        | "ata_secure_erase"
        | "overwrite_single_pass"
      execution_outcome: "pending" | "succeeded" | "failed" | "not_run"
      failure_action: "fail" | "quarantine"
      intake_condition:
        | "good"
        | "fair"
        | "damaged"
        | "missing_parts"
        | "unknown"
      invitation_status: "pending" | "accepted" | "revoked"
      job_status:
        | "draft"
        | "awaiting_authorization"
        | "queued"
        | "running"
        | "verifying"
        | "awaiting_validation"
        | "approved"
        | "failed"
        | "interrupted"
        | "unsupported"
        | "quarantined"
        | "cancelled"
      membership_status: "active" | "revoked"
      org_role: "owner" | "admin" | "technician" | "auditor" | "customer_viewer"
      org_status: "active" | "suspended" | "closed"
      project_status:
        | "planned"
        | "active"
        | "on_hold"
        | "completed"
        | "cancelled"
      record_source: "manual" | "csv_import" | "agent_reported"
      verification_outcome: "pending" | "passed" | "failed" | "not_run"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      agent_status: ["active", "revoked"],
      batch_status: ["open", "processing", "closed"],
      custody_event_type: [
        "received",
        "moved",
        "assigned",
        "status_changed",
        "quarantined",
        "released",
        "drive_attached",
        "drive_detached",
        "note",
      ],
      device_status: [
        "received",
        "awaiting_processing",
        "in_processing",
        "quarantined",
        "processed",
        "released",
        "referred_manual",
      ],
      drive_interface: [
        "sata_hdd",
        "sata_ssd",
        "nvme_ssd",
        "unsupported_other",
      ],
      erasure_method: [
        "nvme_sanitize_crypto",
        "nvme_sanitize_block",
        "nvme_format_crypto",
        "ata_sanitize_crypto",
        "ata_sanitize_block",
        "ata_enhanced_secure_erase",
        "ata_secure_erase",
        "overwrite_single_pass",
      ],
      execution_outcome: ["pending", "succeeded", "failed", "not_run"],
      failure_action: ["fail", "quarantine"],
      intake_condition: ["good", "fair", "damaged", "missing_parts", "unknown"],
      invitation_status: ["pending", "accepted", "revoked"],
      job_status: [
        "draft",
        "awaiting_authorization",
        "queued",
        "running",
        "verifying",
        "awaiting_validation",
        "approved",
        "failed",
        "interrupted",
        "unsupported",
        "quarantined",
        "cancelled",
      ],
      membership_status: ["active", "revoked"],
      org_role: ["owner", "admin", "technician", "auditor", "customer_viewer"],
      org_status: ["active", "suspended", "closed"],
      project_status: [
        "planned",
        "active",
        "on_hold",
        "completed",
        "cancelled",
      ],
      record_source: ["manual", "csv_import", "agent_reported"],
      verification_outcome: ["pending", "passed", "failed", "not_run"],
    },
  },
} as const
