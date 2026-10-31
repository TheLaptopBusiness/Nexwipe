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
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { _token: string }; Returns: string }
      create_invitation: {
        Args: {
          _email: string
          _org: string
          _role: Database["public"]["Enums"]["org_role"]
        }
        Returns: string
      }
      create_organization: {
        Args: { _name: string; _slug: string }
        Returns: string
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
      preview_invitation: {
        Args: { _token: string }
        Returns: {
          email: string
          expired: boolean
          org_name: string
          role: Database["public"]["Enums"]["org_role"]
        }[]
      }
      revoke_invitation: { Args: { _invitation: string }; Returns: undefined }
      revoke_member: { Args: { _membership: string }; Returns: undefined }
      shares_org_with: { Args: { _user: string }; Returns: boolean }
      update_member_role: {
        Args: {
          _membership: string
          _role: Database["public"]["Enums"]["org_role"]
        }
        Returns: undefined
      }
    }
    Enums: {
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
      intake_condition:
        | "good"
        | "fair"
        | "damaged"
        | "missing_parts"
        | "unknown"
      invitation_status: "pending" | "accepted" | "revoked"
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
      intake_condition: ["good", "fair", "damaged", "missing_parts", "unknown"],
      invitation_status: ["pending", "accepted", "revoked"],
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
    },
  },
} as const
