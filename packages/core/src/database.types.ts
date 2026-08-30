// Generated from the live Postgres schema — do not edit by hand.
//
// Regenerate from apps/web:
//   SUPABASE_PROJECT_ID=zwtnpyjifbdytlektxlc npm run db:types
//
// Re-run after every migration. This file is what narrows every `.from()` and
// `.select()` in the app, so a stale copy silently re-opens the hole it exists
// to close: a mistyped table or column compiling clean and failing at runtime.
// The build is not gated on regeneration — that would block iterating on a
// migration locally — so CI typecheck is the backstop.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _photo_backup_pre_v2: {
        Row: {
          backed_up_at: string | null
          equip_photo_url: string | null
          equipment_id: string | null
          has_equip_photo: boolean | null
          has_iso_photo: boolean | null
          iso_photo_is_placeholder: boolean | null
          iso_photo_provenance: string | null
          iso_photo_url: string | null
        }
        Insert: {
          backed_up_at?: string | null
          equip_photo_url?: string | null
          equipment_id?: string | null
          has_equip_photo?: boolean | null
          has_iso_photo?: boolean | null
          iso_photo_is_placeholder?: boolean | null
          iso_photo_provenance?: string | null
          iso_photo_url?: string | null
        }
        Update: {
          backed_up_at?: string | null
          equip_photo_url?: string | null
          equipment_id?: string | null
          has_equip_photo?: boolean | null
          has_iso_photo?: boolean | null
          iso_photo_is_placeholder?: boolean | null
          iso_photo_provenance?: string | null
          iso_photo_url?: string | null
        }
        Relationships: []
      }
      action_item_comments: {
        Row: {
          author_user_id: string
          body: string
          body_mentions: string[]
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          incident_action_id: string
          tenant_id: string
        }
        Insert: {
          author_user_id: string
          body: string
          body_mentions?: string[]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          incident_action_id: string
          tenant_id: string
        }
        Update: {
          author_user_id?: string
          body?: string
          body_mentions?: string[]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          incident_action_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_item_comments_incident_action_id_fkey"
            columns: ["incident_action_id"]
            isOneToOne: false
            referencedRelation: "incident_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_item_comments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_action_queue: {
        Row: {
          action: string
          apply_result: Json | null
          authorizing_role: string
          conversation_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          error: string | null
          id: string
          payload: Json
          rejection_reason: string | null
          requested_at: string
          requested_by: string
          reversible: boolean
          rolled_back_at: string | null
          rolled_back_by: string | null
          status: string
          summary: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          action: string
          apply_result?: Json | null
          authorizing_role: string
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          error?: string | null
          id?: string
          payload?: Json
          rejection_reason?: string | null
          requested_at?: string
          requested_by: string
          reversible: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          status?: string
          summary: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          apply_result?: Json | null
          authorizing_role?: string
          conversation_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          error?: string | null
          id?: string
          payload?: Json
          rejection_reason?: string | null
          requested_at?: string
          requested_by?: string
          reversible?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          status?: string
          summary?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_action_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "operator_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_queue_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_queue_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_queue_rolled_back_by_fkey"
            columns: ["rolled_back_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_action_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_invocations: {
        Row: {
          cache_read_tokens: number | null
          cache_write_tokens: number | null
          context: string | null
          id: number
          input_tokens: number | null
          model: string
          occurred_at: string
          output_tokens: number | null
          status: string
          surface: string
          tenant_id: string | null
          user_id: string
        }
        Insert: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          context?: string | null
          id?: number
          input_tokens?: number | null
          model: string
          occurred_at?: string
          output_tokens?: number | null
          status: string
          surface: string
          tenant_id?: string | null
          user_id: string
        }
        Update: {
          cache_read_tokens?: number | null
          cache_write_tokens?: number | null
          context?: string | null
          id?: number
          input_tokens?: number | null
          model?: string
          occurred_at?: string
          output_tokens?: number | null
          status?: string
          surface?: string
          tenant_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_invocations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      anon_report_ip_attempts: {
        Row: {
          attempted_at: string
          id: number
          ip_hash: string
          outcome: string
          token_id: string | null
        }
        Insert: {
          attempted_at?: string
          id?: number
          ip_hash: string
          outcome: string
          token_id?: string | null
        }
        Update: {
          attempted_at?: string
          id?: number
          ip_hash?: string
          outcome?: string
          token_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "anon_report_ip_attempts_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "incident_anon_intake_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_conversations: {
        Row: {
          id: string
          last_message_at: string
          origin_path: string | null
          started_at: string
          tenant_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          id?: string
          last_message_at?: string
          origin_path?: string | null
          started_at?: string
          tenant_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          id?: string
          last_message_at?: string
          origin_path?: string | null
          started_at?: string
          tenant_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          cache_read_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          input_tokens: number | null
          metadata: Json | null
          output_tokens: number | null
          role: string
        }
        Insert: {
          cache_read_tokens?: number | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          role: string
        }
        Update: {
          cache_read_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_tasks: {
        Row: {
          attempts: number
          conversation_id: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          payload: Json
          run_at: string
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          payload: Json
          run_at: string
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          conversation_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          payload?: Json
          run_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_tasks_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assistant_tasks_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: number
          new_row: Json | null
          old_row: Json | null
          operation: string
          row_pk: string | null
          table_name: string
          tenant_id: string | null
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: number
          new_row?: Json | null
          old_row?: Json | null
          operation: string
          row_pk?: string | null
          table_name: string
          tenant_id?: string | null
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: number
          new_row?: Json | null
          old_row?: Json | null
          operation?: string
          row_pk?: string | null
          table_name?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bbs_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "bbs_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bbs_observation_actions: {
        Row: {
          action_type: string
          body: string | null
          created_at: string
          created_by: string | null
          id: number
          meta: Json | null
          observation_id: string
          tenant_id: string
        }
        Insert: {
          action_type: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: number
          meta?: Json | null
          observation_id: string
          tenant_id: string
        }
        Update: {
          action_type?: string
          body?: string | null
          created_at?: string
          created_by?: string | null
          id?: number
          meta?: Json | null
          observation_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bbs_observation_actions_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "bbs_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_observation_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bbs_observation_photos: {
        Row: {
          annotations: Json | null
          created_at: string
          created_by: string | null
          file_path: string
          id: string
          observation_id: string
          tenant_id: string
        }
        Insert: {
          annotations?: Json | null
          created_at?: string
          created_by?: string | null
          file_path: string
          id?: string
          observation_id: string
          tenant_id: string
        }
        Update: {
          annotations?: Json | null
          created_at?: string
          created_by?: string | null
          file_path?: string
          id?: string
          observation_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bbs_observation_photos_observation_id_fkey"
            columns: ["observation_id"]
            isOneToOne: false
            referencedRelation: "bbs_observations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_observation_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bbs_observations: {
        Row: {
          abc_antecedent: string | null
          abc_behavior: string | null
          abc_consequence: string | null
          anonymous: boolean
          assigned_to: string | null
          category: string | null
          closed_at: string | null
          closed_by: string | null
          corrective_action: string | null
          created_at: string
          department: string | null
          description: string
          due_date: string | null
          facility_id: string | null
          id: string
          immediate_action_taken: string | null
          kind: string
          likelihood: string | null
          location_text: string | null
          observed_at: string
          points_awarded: number
          qr_location_id: string | null
          report_number: string | null
          risk_score: number | null
          severity: string | null
          status: string
          submitted_by: string | null
          submitted_email: string | null
          submitted_name: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          abc_antecedent?: string | null
          abc_behavior?: string | null
          abc_consequence?: string | null
          anonymous?: boolean
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          corrective_action?: string | null
          created_at?: string
          department?: string | null
          description: string
          due_date?: string | null
          facility_id?: string | null
          id?: string
          immediate_action_taken?: string | null
          kind: string
          likelihood?: string | null
          location_text?: string | null
          observed_at?: string
          points_awarded?: number
          qr_location_id?: string | null
          report_number?: string | null
          risk_score?: number | null
          severity?: string | null
          status?: string
          submitted_by?: string | null
          submitted_email?: string | null
          submitted_name?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          abc_antecedent?: string | null
          abc_behavior?: string | null
          abc_consequence?: string | null
          anonymous?: boolean
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          corrective_action?: string | null
          created_at?: string
          department?: string | null
          description?: string
          due_date?: string | null
          facility_id?: string | null
          id?: string
          immediate_action_taken?: string | null
          kind?: string
          likelihood?: string | null
          location_text?: string | null
          observed_at?: string
          points_awarded?: number
          qr_location_id?: string | null
          report_number?: string | null
          risk_score?: number | null
          severity?: string | null
          status?: string
          submitted_by?: string | null
          submitted_email?: string | null
          submitted_name?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bbs_observations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_observations_qr_location_id_fkey"
            columns: ["qr_location_id"]
            isOneToOne: false
            referencedRelation: "bbs_qr_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_observations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bbs_observations_v2: {
        Row: {
          category: string
          control_recommendation: string | null
          created_at: string
          description: string
          facility_id: string | null
          feedback_given_at: string | null
          follow_up_completed_at: string | null
          follow_up_required: boolean
          hierarchy_level: string | null
          id: string
          location_text: string | null
          observed_worker_id: string | null
          observer_user_id: string
          photo_url: string | null
          severity: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category: string
          control_recommendation?: string | null
          created_at?: string
          description: string
          facility_id?: string | null
          feedback_given_at?: string | null
          follow_up_completed_at?: string | null
          follow_up_required?: boolean
          hierarchy_level?: string | null
          id?: string
          location_text?: string | null
          observed_worker_id?: string | null
          observer_user_id: string
          photo_url?: string | null
          severity: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          control_recommendation?: string | null
          created_at?: string
          description?: string
          facility_id?: string | null
          feedback_given_at?: string | null
          follow_up_completed_at?: string | null
          follow_up_required?: boolean
          hierarchy_level?: string | null
          id?: string
          location_text?: string | null
          observed_worker_id?: string | null
          observer_user_id?: string
          photo_url?: string | null
          severity?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bbs_observations_v2_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_observations_v2_observed_worker_id_fkey"
            columns: ["observed_worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "bbs_observations_v2_observed_worker_id_fkey"
            columns: ["observed_worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_observations_v2_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bbs_qr_locations: {
        Row: {
          active: boolean
          area: string | null
          created_at: string
          created_by: string | null
          description: string | null
          facility_id: string | null
          id: string
          name: string
          tenant_id: string
          token: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          facility_id?: string | null
          id?: string
          name: string
          tenant_id: string
          token: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          area?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          tenant_id?: string
          token?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bbs_qr_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bbs_qr_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_members: {
        Row: {
          channel_id: string
          joined_at: string
          last_read_message_id: string | null
          muted_at: string | null
          role: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          joined_at?: string
          last_read_message_id?: string | null
          muted_at?: string | null
          role?: string
          tenant_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          joined_at?: string
          last_read_message_id?: string | null
          muted_at?: string | null
          role?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channel_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string
          description: string | null
          id: string
          kind: string
          last_activity_at: string
          name: string | null
          slug: string | null
          tenant_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          kind: string
          last_activity_at?: string
          name?: string | null
          slug?: string | null
          tenant_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          kind?: string
          last_activity_at?: string
          name?: string | null
          slug?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_attachments: {
        Row: {
          created_at: string
          filename: string | null
          height: number | null
          id: string
          message_id: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
          width: number | null
        }
        Insert: {
          created_at?: string
          filename?: string | null
          height?: number | null
          id?: string
          message_id?: string | null
          mime_type: string
          size_bytes: number
          storage_path: string
          tenant_id: string
          uploaded_by: string
          width?: number | null
        }
        Update: {
          created_at?: string
          filename?: string | null
          height?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_message_reactions: {
        Row: {
          created_at: string
          emoji: string
          message_id: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          message_id: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          message_id?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_message_reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          author_user_id: string
          body: string
          body_mentions: string[]
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_message_id: string | null
          tenant_id: string
        }
        Insert: {
          author_user_id: string
          body: string
          body_mentions?: string[]
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          tenant_id: string
        }
        Update: {
          author_user_id?: string
          body?: string
          body_mentions?: string[]
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_barcode_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "chemical_barcode_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_exposure_events: {
        Row: {
          created_at: string
          created_by: string | null
          estimated_quantity: string | null
          exposure_duration_minutes: number | null
          facility_id: string | null
          id: string
          incident_id: string
          inventory_item_id: string | null
          measured_ppm: number | null
          notes: string | null
          person_id: string | null
          ppe_in_use: string[]
          product_id: string
          route: string
          severity: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          estimated_quantity?: string | null
          exposure_duration_minutes?: number | null
          facility_id?: string | null
          id?: string
          incident_id: string
          inventory_item_id?: string | null
          measured_ppm?: number | null
          notes?: string | null
          person_id?: string | null
          ppe_in_use?: string[]
          product_id: string
          route: string
          severity?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          estimated_quantity?: string | null
          exposure_duration_minutes?: number | null
          facility_id?: string | null
          id?: string
          incident_id?: string
          inventory_item_id?: string | null
          measured_ppm?: number | null
          notes?: string | null
          person_id?: string | null
          ppe_in_use?: string[]
          product_id?: string
          route?: string
          severity?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_exposure_events_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "chemical_inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_inventory_item_id_fkey"
            columns: ["inventory_item_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "incident_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "incident_people_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_exposure_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_incompatibility_overrides: {
        Row: {
          compatible: boolean
          created_at: string
          created_by: string | null
          id: string
          key_a: string
          key_b: string
          key_kind: string
          reason: string | null
          tenant_id: string
        }
        Insert: {
          compatible: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          key_a: string
          key_b: string
          key_kind: string
          reason?: string | null
          tenant_id: string
        }
        Update: {
          compatible?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          key_a?: string
          key_b?: string
          key_kind?: string
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_incompatibility_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_inventory_items: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          assigned_to: string | null
          barcode: string
          container_type: string | null
          cost_cents: number | null
          created_at: string
          created_by: string | null
          department: string | null
          disposed_at: string | null
          disposed_by: string | null
          disposed_method: string | null
          expiration_date: string | null
          facility_id: string | null
          id: string
          location_id: string | null
          lot_number: string | null
          manifest_id: string | null
          manufacture_date: string | null
          notes: string | null
          opened_date: string | null
          product_id: string
          purchase_order: string | null
          quantity: number
          received_date: string | null
          rejection_reason: string | null
          requested_at: string | null
          requested_by: string | null
          status: string
          tenant_id: string
          unit: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          barcode: string
          container_type?: string | null
          cost_cents?: number | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          disposed_at?: string | null
          disposed_by?: string | null
          disposed_method?: string | null
          expiration_date?: string | null
          facility_id?: string | null
          id?: string
          location_id?: string | null
          lot_number?: string | null
          manifest_id?: string | null
          manufacture_date?: string | null
          notes?: string | null
          opened_date?: string | null
          product_id: string
          purchase_order?: string | null
          quantity?: number
          received_date?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          requested_by?: string | null
          status?: string
          tenant_id: string
          unit: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          assigned_to?: string | null
          barcode?: string
          container_type?: string | null
          cost_cents?: number | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          disposed_at?: string | null
          disposed_by?: string | null
          disposed_method?: string | null
          expiration_date?: string | null
          facility_id?: string | null
          id?: string
          location_id?: string | null
          lot_number?: string | null
          manifest_id?: string | null
          manufacture_date?: string | null
          notes?: string | null
          opened_date?: string | null
          product_id?: string
          purchase_order?: string | null
          quantity?: number
          received_date?: string | null
          rejection_reason?: string | null
          requested_at?: string | null
          requested_by?: string | null
          status?: string
          tenant_id?: string
          unit?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_inventory_items_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "chemical_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_label_prints: {
        Row: {
          byte_size: number | null
          field_snapshot: Json
          filename: string
          id: string
          printed_at: string
          printed_by: string | null
          product_id: string
          size_key: string
          template: string
          tenant_id: string
        }
        Insert: {
          byte_size?: number | null
          field_snapshot: Json
          filename: string
          id?: string
          printed_at?: string
          printed_by?: string | null
          product_id: string
          size_key: string
          template: string
          tenant_id: string
        }
        Update: {
          byte_size?: number | null
          field_snapshot?: Json
          filename?: string
          id?: string
          printed_at?: string
          printed_by?: string | null
          product_id?: string
          size_key?: string
          template?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_label_prints_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_label_prints_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_label_prints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_locations: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          kind: string
          name: string
          notes: string | null
          parent_id: string | null
          path: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          kind?: string
          name: string
          notes?: string | null
          parent_id?: string | null
          path?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          parent_id?: string | null
          path?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_locations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "chemical_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_locations_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "chemical_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_max_allowable_quantities: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          location_id: string | null
          max_quantity: number
          notes: string | null
          product_id: string | null
          reference: string | null
          storage_class: string | null
          tenant_id: string
          unit: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          max_quantity: number
          notes?: string | null
          product_id?: string | null
          reference?: string | null
          storage_class?: string | null
          tenant_id: string
          unit: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string | null
          max_quantity?: number
          notes?: string | null
          product_id?: string | null
          reference?: string | null
          storage_class?: string | null
          tenant_id?: string
          unit?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_max_allowable_quantities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "chemical_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_products: {
        Row: {
          active_sds_id: string | null
          archived_at: string | null
          boiling_point_c: number | null
          cas_numbers: string[]
          created_at: string
          created_by: string | null
          dot_hazard_class: string | null
          dot_packing_group: string | null
          dot_un_number: string | null
          emergency_phone: string | null
          facility_id: string | null
          firefighting: Json | null
          first_aid: Json | null
          flash_point_c: number | null
          ghs_pictograms: string[]
          ghs_signal_word: string | null
          hazard_statements: Json | null
          id: string
          idlh_ppm: number | null
          incompatibilities: string[]
          manufacturer: string | null
          name: string
          nfpa_flammability: number | null
          nfpa_health: number | null
          nfpa_instability: number | null
          nfpa_special: string | null
          notes: string | null
          pel_twa_ppm: number | null
          physical_state: string | null
          ppe_required: string[]
          precautionary_statements: Json | null
          product_code: string | null
          sds_fetch_pending: boolean
          sds_revision_date: string | null
          sds_source_url: string | null
          spill_cleanup: Json | null
          stel_ppm: number | null
          storage_class: string | null
          synonyms: string[]
          synonyms_text: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vapor_pressure_kpa: number | null
        }
        Insert: {
          active_sds_id?: string | null
          archived_at?: string | null
          boiling_point_c?: number | null
          cas_numbers?: string[]
          created_at?: string
          created_by?: string | null
          dot_hazard_class?: string | null
          dot_packing_group?: string | null
          dot_un_number?: string | null
          emergency_phone?: string | null
          facility_id?: string | null
          firefighting?: Json | null
          first_aid?: Json | null
          flash_point_c?: number | null
          ghs_pictograms?: string[]
          ghs_signal_word?: string | null
          hazard_statements?: Json | null
          id?: string
          idlh_ppm?: number | null
          incompatibilities?: string[]
          manufacturer?: string | null
          name: string
          nfpa_flammability?: number | null
          nfpa_health?: number | null
          nfpa_instability?: number | null
          nfpa_special?: string | null
          notes?: string | null
          pel_twa_ppm?: number | null
          physical_state?: string | null
          ppe_required?: string[]
          precautionary_statements?: Json | null
          product_code?: string | null
          sds_fetch_pending?: boolean
          sds_revision_date?: string | null
          sds_source_url?: string | null
          spill_cleanup?: Json | null
          stel_ppm?: number | null
          storage_class?: string | null
          synonyms?: string[]
          synonyms_text?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vapor_pressure_kpa?: number | null
        }
        Update: {
          active_sds_id?: string | null
          archived_at?: string | null
          boiling_point_c?: number | null
          cas_numbers?: string[]
          created_at?: string
          created_by?: string | null
          dot_hazard_class?: string | null
          dot_packing_group?: string | null
          dot_un_number?: string | null
          emergency_phone?: string | null
          facility_id?: string | null
          firefighting?: Json | null
          first_aid?: Json | null
          flash_point_c?: number | null
          ghs_pictograms?: string[]
          ghs_signal_word?: string | null
          hazard_statements?: Json | null
          id?: string
          idlh_ppm?: number | null
          incompatibilities?: string[]
          manufacturer?: string | null
          name?: string
          nfpa_flammability?: number | null
          nfpa_health?: number | null
          nfpa_instability?: number | null
          nfpa_special?: string | null
          notes?: string | null
          pel_twa_ppm?: number | null
          physical_state?: string | null
          ppe_required?: string[]
          precautionary_statements?: Json | null
          product_code?: string | null
          sds_fetch_pending?: boolean
          sds_revision_date?: string | null
          sds_source_url?: string | null
          spill_cleanup?: Json | null
          stel_ppm?: number | null
          storage_class?: string | null
          synonyms?: string[]
          synonyms_text?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vapor_pressure_kpa?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_products_active_sds_fk"
            columns: ["active_sds_id"]
            isOneToOne: false
            referencedRelation: "chemical_sds_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_products_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_restricted_list: {
        Row: {
          alternative: string | null
          cas_number: string | null
          created_at: string
          created_by: string | null
          id: string
          name_pattern: string | null
          reason: string | null
          reference: string | null
          severity: string
          tenant_id: string
        }
        Insert: {
          alternative?: string | null
          cas_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name_pattern?: string | null
          reason?: string | null
          reference?: string | null
          severity?: string
          tenant_id: string
        }
        Update: {
          alternative?: string | null
          cas_number?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          name_pattern?: string | null
          reason?: string | null
          reference?: string | null
          severity?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_restricted_list_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_sds_documents: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string | null
          file_bytes: number | null
          file_hash: string | null
          id: string
          language: string
          mime_type: string
          parse_confidence: number | null
          parse_model: string | null
          parse_review_status: string
          parsed_payload: Json | null
          product_id: string
          revision_date: string | null
          source: string
          storage_path: string
          superseded_at: string | null
          superseded_by: string | null
          superseded_reason: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          file_bytes?: number | null
          file_hash?: string | null
          id?: string
          language?: string
          mime_type?: string
          parse_confidence?: number | null
          parse_model?: string | null
          parse_review_status?: string
          parsed_payload?: Json | null
          product_id: string
          revision_date?: string | null
          source?: string
          storage_path: string
          superseded_at?: string | null
          superseded_by?: string | null
          superseded_reason?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          file_bytes?: number | null
          file_hash?: string | null
          id?: string
          language?: string
          mime_type?: string
          parse_confidence?: number | null
          parse_model?: string | null
          parse_review_status?: string
          parsed_payload?: Json | null
          product_id?: string
          revision_date?: string | null
          source?: string
          storage_path?: string
          superseded_at?: string | null
          superseded_by?: string | null
          superseded_reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_sds_documents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_sds_documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_sds_documents_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_sds_documents_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "chemical_sds_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_sds_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_sds_revision_checks: {
        Row: {
          baseline_file_hash: string | null
          baseline_revision_date: string | null
          baseline_sds_id: string | null
          checked_at: string
          http_status: number | null
          id: number
          latest_file_hash: string | null
          latest_revision_date: string | null
          new_sds_id: string | null
          notes: string | null
          outcome: string
          product_id: string
          source_url: string
          tenant_id: string
          trigger: string
          triggered_by: string | null
        }
        Insert: {
          baseline_file_hash?: string | null
          baseline_revision_date?: string | null
          baseline_sds_id?: string | null
          checked_at?: string
          http_status?: number | null
          id?: number
          latest_file_hash?: string | null
          latest_revision_date?: string | null
          new_sds_id?: string | null
          notes?: string | null
          outcome: string
          product_id: string
          source_url: string
          tenant_id: string
          trigger?: string
          triggered_by?: string | null
        }
        Update: {
          baseline_file_hash?: string | null
          baseline_revision_date?: string | null
          baseline_sds_id?: string | null
          checked_at?: string
          http_status?: number | null
          id?: number
          latest_file_hash?: string | null
          latest_revision_date?: string | null
          new_sds_id?: string | null
          notes?: string | null
          outcome?: string
          product_id?: string
          source_url?: string
          tenant_id?: string
          trigger?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_sds_revision_checks_baseline_sds_id_fkey"
            columns: ["baseline_sds_id"]
            isOneToOne: false
            referencedRelation: "chemical_sds_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_sds_revision_checks_new_sds_id_fkey"
            columns: ["new_sds_id"]
            isOneToOne: false
            referencedRelation: "chemical_sds_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_sds_revision_checks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_sds_revision_checks_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_sds_revision_checks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chemical_training_requirements: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          product_id: string
          role: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id: string
          role: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          product_id?: string
          role?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chemical_training_requirements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_training_requirements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_training_requirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cmms_integrations: {
        Row: {
          auth_token_encrypted: string | null
          base_url: string | null
          created_at: string
          created_by_user_id: string | null
          enabled: boolean
          id: string
          last_sync_at: string | null
          name: string
          system: string
          tenant_id: string
          updated_at: string
          webhook_secret: string
        }
        Insert: {
          auth_token_encrypted?: string | null
          base_url?: string | null
          created_at?: string
          created_by_user_id?: string | null
          enabled?: boolean
          id?: string
          last_sync_at?: string | null
          name: string
          system: string
          tenant_id: string
          updated_at?: string
          webhook_secret: string
        }
        Update: {
          auth_token_encrypted?: string | null
          base_url?: string | null
          created_at?: string
          created_by_user_id?: string | null
          enabled?: boolean
          id?: string
          last_sync_at?: string | null
          name?: string
          system?: string
          tenant_id?: string
          updated_at?: string
          webhook_secret?: string
        }
        Relationships: [
          {
            foreignKeyName: "cmms_integrations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cmms_sync_events: {
        Row: {
          attempts: number
          created_at: string
          direction: string
          error_message: string | null
          event_type: string
          id: string
          integration_id: string
          payload: Json
          processed_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          direction: string
          error_message?: string | null
          event_type: string
          id?: string
          integration_id: string
          payload?: Json
          processed_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          direction?: string
          error_message?: string | null
          event_type?: string
          id?: string
          integration_id?: string
          payload?: Json
          processed_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cmms_sync_events_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "cmms_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cmms_sync_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cmms_work_order_links: {
        Row: {
          closed_at: string | null
          cmms_system: string
          cmms_work_order_id: string
          created_at: string
          equipment_id: string
          id: string
          opened_at: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          cmms_system: string
          cmms_work_order_id: string
          created_at?: string
          equipment_id: string
          id?: string
          opened_at?: string | null
          status: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          cmms_system?: string
          cmms_work_order_id?: string
          created_at?: string
          equipment_id?: string
          id?: string
          opened_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cmms_work_order_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      command_center_safety_alerts: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          created_by: string | null
          id: string
          incident_id: string
          priority: number
          report_number: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity_tone: string
          source: string
          status: string
          summary: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id: string
          priority?: number
          report_number: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity_tone: string
          source?: string
          status?: string
          summary: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          incident_id?: string
          priority?: number
          report_number?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity_tone?: string
          source?: string
          status?: string
          summary?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "command_center_safety_alerts_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "command_center_safety_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_calendar_events: {
        Row: {
          completed_at: string
          completed_by: string | null
          created_at: string
          evidence_id: string | null
          id: string
          note: string | null
          obligation_id: string
          occurrence_at: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          note?: string | null
          obligation_id: string
          occurrence_at: string
          tenant_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          created_at?: string
          evidence_id?: string | null
          id?: string
          note?: string | null
          obligation_id?: string
          occurrence_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_calendar_events_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_calendar_events_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_calendar_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_calendar_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_calendar_obligations: {
        Row: {
          cadence: string
          cadence_days: number | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          evidence_id: string | null
          facility_id: string | null
          id: string
          next_due_at: string
          owner_user_id: string | null
          regulatory_ref: string | null
          site_label: string | null
          source: string
          status: string
          system_key: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          cadence?: string
          cadence_days?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          evidence_id?: string | null
          facility_id?: string | null
          id?: string
          next_due_at: string
          owner_user_id?: string | null
          regulatory_ref?: string | null
          site_label?: string | null
          source?: string
          status?: string
          system_key?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          cadence?: string
          cadence_days?: number | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          evidence_id?: string | null
          facility_id?: string | null
          id?: string
          next_due_at?: string
          owner_user_id?: string | null
          regulatory_ref?: string | null
          site_label?: string | null
          source?: string
          status?: string
          system_key?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_calendar_obligations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_calendar_obligations_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_calendar_obligations_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_calendar_obligations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_obligation_completions: {
        Row: {
          completed_at: string
          completed_by: string | null
          evidence_url: string | null
          id: string
          notes: string | null
          obligation_id: string
          tenant_id: string
        }
        Insert: {
          completed_at?: string
          completed_by?: string | null
          evidence_url?: string | null
          id?: string
          notes?: string | null
          obligation_id: string
          tenant_id: string
        }
        Update: {
          completed_at?: string
          completed_by?: string | null
          evidence_url?: string | null
          id?: string
          notes?: string | null
          obligation_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_obligation_completions_obligation_id_fkey"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "compliance_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_obligation_completions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_obligations: {
        Row: {
          ai_generated: boolean
          ai_model: string | null
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          evidence_required: boolean
          frequency: string
          frequency_days: number | null
          id: string
          jurisdiction: string | null
          last_completed_at: string | null
          lead_days: number
          legal_register_id: string | null
          next_due_date: string
          not_applicable: boolean
          notes: string | null
          responsible_party: string | null
          snoozed_until: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_generated?: boolean
          ai_model?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          evidence_required?: boolean
          frequency?: string
          frequency_days?: number | null
          id?: string
          jurisdiction?: string | null
          last_completed_at?: string | null
          lead_days?: number
          legal_register_id?: string | null
          next_due_date: string
          not_applicable?: boolean
          notes?: string | null
          responsible_party?: string | null
          snoozed_until?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_generated?: boolean
          ai_model?: string | null
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          evidence_required?: boolean
          frequency?: string
          frequency_days?: number | null
          id?: string
          jurisdiction?: string | null
          last_completed_at?: string | null
          lead_days?: number
          legal_register_id?: string | null
          next_due_date?: string
          not_applicable?: boolean
          notes?: string | null
          responsible_party?: string | null
          snoozed_until?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compliance_obligations_legal_register_id_fkey"
            columns: ["legal_register_id"]
            isOneToOne: false
            referencedRelation: "legal_register"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compliance_obligations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_project_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "construction_project_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_projects: {
        Row: {
          actual_end_date: string | null
          address_line1: string | null
          city: string | null
          client_project_number: string | null
          country: string
          created_at: string
          created_by: string | null
          default_work_days: number[]
          description: string | null
          facility_id: string
          id: string
          jurisdiction_id: string
          latitude: number | null
          longitude: number | null
          name: string
          postal_code: string | null
          project_number: string | null
          project_type: string
          scheduled_end_date: string | null
          settings: Json
          start_date: string | null
          state: string | null
          status: string
          tenant_id: string
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          actual_end_date?: string | null
          address_line1?: string | null
          city?: string | null
          client_project_number?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          default_work_days?: number[]
          description?: string | null
          facility_id: string
          id?: string
          jurisdiction_id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          postal_code?: string | null
          project_number?: string | null
          project_type?: string
          scheduled_end_date?: string | null
          settings?: Json
          start_date?: string | null
          state?: string | null
          status?: string
          tenant_id: string
          timezone: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          actual_end_date?: string | null
          address_line1?: string | null
          city?: string | null
          client_project_number?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          default_work_days?: number[]
          description?: string | null
          facility_id?: string
          id?: string
          jurisdiction_id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          postal_code?: string | null
          project_number?: string | null
          project_type?: string
          scheduled_end_date?: string | null
          settings?: Json
          start_date?: string | null
          state?: string | null
          status?: string
          tenant_id?: string
          timezone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_projects_facility_fk"
            columns: ["tenant_id", "facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "construction_projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      controls_library: {
        Row: {
          active: boolean
          applicable_categories: Json
          created_at: string
          created_by: string | null
          description: string | null
          facility_id: string | null
          hierarchy_level: string
          id: string
          name: string
          regulatory_ref: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          applicable_categories?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          facility_id?: string | null
          hierarchy_level: string
          id?: string
          name: string
          regulatory_ref?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          applicable_categories?: Json
          created_at?: string
          created_by?: string | null
          description?: string | null
          facility_id?: string | null
          hierarchy_level?: string
          id?: string
          name?: string
          regulatory_ref?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "controls_library_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "controls_library_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_runs: {
        Row: {
          cron_path: string
          ended_at: string | null
          id: number
          started_at: string
          status: string | null
          summary: string | null
          trigger: string
          triggered_by: string | null
        }
        Insert: {
          cron_path: string
          ended_at?: string | null
          id?: number
          started_at?: string
          status?: string | null
          summary?: string | null
          trigger?: string
          triggered_by?: string | null
        }
        Update: {
          cron_path?: string
          ended_at?: string | null
          id?: number
          started_at?: string
          status?: string | null
          summary?: string | null
          trigger?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cron_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dot_hazard_class_catalog: {
        Row: {
          class_number: number
          created_at: string
          division: string | null
          id: string
          image_path: string
          label_name: string
          placard_background: string
          placard_color: string
          sort_order: number
          symbol_legend: string
          un_class_text: string | null
          updated_at: string
        }
        Insert: {
          class_number: number
          created_at?: string
          division?: string | null
          id: string
          image_path: string
          label_name: string
          placard_background: string
          placard_color: string
          sort_order: number
          symbol_legend: string
          un_class_text?: string | null
          updated_at?: string
        }
        Update: {
          class_number?: number
          created_at?: string
          division?: string | null
          id?: string
          image_path?: string
          label_name?: string
          placard_background?: string
          placard_color?: string
          sort_order?: number
          symbol_legend?: string
          un_class_text?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ehs_scorecard_targets: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          kind: string
          metric: string
          note: string | null
          period_year: number | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          kind: string
          metric: string
          note?: string | null
          period_year?: number | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          kind?: string
          metric?: string
          note?: string | null
          period_year?: number | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "ehs_scorecard_targets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ehs_scorecard_targets_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ehs_scorecard_targets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ehs_scorecard_targets_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      em385_document_files: {
        Row: {
          file_hash_sha256: string | null
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          register_item_id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
          version_label: string | null
        }
        Insert: {
          file_hash_sha256?: string | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          register_item_id: string
          storage_path: string
          tenant_id: string
          uploaded_at?: string
          uploaded_by?: string | null
          version_label?: string | null
        }
        Update: {
          file_hash_sha256?: string | null
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          register_item_id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
          version_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "em385_document_files_register_item_id_fkey"
            columns: ["register_item_id"]
            isOneToOne: false
            referencedRelation: "em385_register_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "em385_document_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      em385_project_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "em385_project_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      em385_projects: {
        Row: {
          contract_number: string
          created_at: string
          edition: string
          end_date: string | null
          facility_id: string | null
          gda: string | null
          id: string
          location: string | null
          prime_contractor: string | null
          project_number: string | null
          ssho_name: string | null
          start_date: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          contract_number: string
          created_at?: string
          edition: string
          end_date?: string | null
          facility_id?: string | null
          gda?: string | null
          id?: string
          location?: string | null
          prime_contractor?: string | null
          project_number?: string | null
          ssho_name?: string | null
          start_date?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          contract_number?: string
          created_at?: string
          edition?: string
          end_date?: string | null
          facility_id?: string | null
          gda?: string | null
          id?: string
          location?: string | null
          prime_contractor?: string | null
          project_number?: string | null
          ssho_name?: string | null
          start_date?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "em385_projects_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "em385_projects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      em385_register_item_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          after_row: Json | null
          before_row: Json | null
          context: string | null
          event_type: string
          id: number
          occurred_at: string
          register_item_id: string
          tenant_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type: string
          id?: number
          occurred_at?: string
          register_item_id: string
          tenant_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type?: string
          id?: number
          occurred_at?: string
          register_item_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "em385_register_item_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      em385_register_items: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          category: string
          created_at: string
          due_date: string | null
          effective_date: string | null
          expires_at: string | null
          id: string
          linked_module: string | null
          linked_record_id: string | null
          not_applicable_justification: string | null
          notes: string | null
          project_id: string
          requirement_id: string | null
          responsible_party: string | null
          status: string
          submitted_at: string | null
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
          version: string | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          category: string
          created_at?: string
          due_date?: string | null
          effective_date?: string | null
          expires_at?: string | null
          id?: string
          linked_module?: string | null
          linked_record_id?: string | null
          not_applicable_justification?: string | null
          notes?: string | null
          project_id: string
          requirement_id?: string | null
          responsible_party?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: string | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          category?: string
          created_at?: string
          due_date?: string | null
          effective_date?: string | null
          expires_at?: string | null
          id?: string
          linked_module?: string | null
          linked_record_id?: string | null
          not_applicable_justification?: string | null
          notes?: string | null
          project_id?: string
          requirement_id?: string | null
          responsible_party?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "em385_register_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "em385_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "em385_register_items_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "em385_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "em385_register_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      em385_requirements: {
        Row: {
          category: string
          citation: string | null
          code: string
          created_at: string
          default_required: boolean
          description: string | null
          edition: string
          id: string
          links_module: string | null
          record_type: string | null
          renewal_interval_months: number | null
          retention_rule: string | null
          retention_years: number | null
          sort_order: number
          title: string
        }
        Insert: {
          category: string
          citation?: string | null
          code: string
          created_at?: string
          default_required?: boolean
          description?: string | null
          edition: string
          id?: string
          links_module?: string | null
          record_type?: string | null
          renewal_interval_months?: number | null
          retention_rule?: string | null
          retention_years?: number | null
          sort_order?: number
          title: string
        }
        Update: {
          category?: string
          citation?: string | null
          code?: string
          created_at?: string
          default_required?: boolean
          description?: string | null
          edition?: string
          id?: string
          links_module?: string | null
          record_type?: string | null
          renewal_interval_months?: number | null
          retention_rule?: string | null
          retention_years?: number | null
          sort_order?: number
          title?: string
        }
        Relationships: []
      }
      email_log: {
        Row: {
          error_text: string | null
          id: number
          kind: string
          occurred_at: string
          provider_id: string | null
          status: string
          subject: string | null
          tenant_id: string | null
          to_email: string
          triggered_by: string | null
        }
        Insert: {
          error_text?: string | null
          id?: number
          kind: string
          occurred_at?: string
          provider_id?: string | null
          status: string
          subject?: string | null
          tenant_id?: string | null
          to_email: string
          triggered_by?: string | null
        }
        Update: {
          error_text?: string | null
          id?: number
          kind?: string
          occurred_at?: string
          provider_id?: string | null
          status?: string
          subject?: string | null
          tenant_id?: string | null
          to_email?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_log_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          category: string
          created_at: string
          email: string
          id: string
          source: string
        }
        Insert: {
          category?: string
          created_at?: string
          email: string
          id?: string
          source?: string
        }
        Update: {
          category?: string
          created_at?: string
          email?: string
          id?: string
          source?: string
        }
        Relationships: []
      }
      environmental_aspects: {
        Row: {
          activity: string
          aspect: string
          controls: string | null
          created_at: string
          created_by: string | null
          flow: string | null
          id: string
          impact: string
          is_significant: boolean | null
          life_cycle_stage: string
          likelihood: number
          notes: string | null
          operating_condition: string
          owner_user_id: string | null
          related_risk_id: string | null
          severity: number
          significance_score: number | null
          source_reference: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity: string
          aspect: string
          controls?: string | null
          created_at?: string
          created_by?: string | null
          flow?: string | null
          id?: string
          impact: string
          is_significant?: boolean | null
          life_cycle_stage?: string
          likelihood?: number
          notes?: string | null
          operating_condition?: string
          owner_user_id?: string | null
          related_risk_id?: string | null
          severity?: number
          significance_score?: number | null
          source_reference?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity?: string
          aspect?: string
          controls?: string | null
          created_at?: string
          created_by?: string | null
          flow?: string | null
          id?: string
          impact?: string
          is_significant?: boolean | null
          life_cycle_stage?: string
          likelihood?: number
          notes?: string | null
          operating_condition?: string
          owner_user_id?: string | null
          related_risk_id?: string | null
          severity?: number
          significance_score?: number | null
          source_reference?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "environmental_aspects_related_risk_id_fkey"
            columns: ["related_risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "environmental_aspects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      environmental_objective_readings: {
        Row: {
          created_at: string
          id: string
          note: string | null
          objective_id: string
          reading_date: string
          recorded_by: string | null
          tenant_id: string
          value: number
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          objective_id: string
          reading_date?: string
          recorded_by?: string | null
          tenant_id: string
          value: number
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          objective_id?: string
          reading_date?: string
          recorded_by?: string | null
          tenant_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "environmental_objective_readings_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "environmental_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "environmental_objective_readings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      environmental_objectives: {
        Row: {
          baseline_label: string | null
          baseline_value: number | null
          created_at: string
          created_by: string | null
          description: string | null
          evaluation_method: string | null
          id: string
          improvement_direction: string
          indicator: string | null
          notes: string | null
          owner_user_id: string | null
          related_aspect_id: string | null
          status: string
          target_date: string | null
          target_value: number | null
          tenant_id: string
          title: string
          unit: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          baseline_label?: string | null
          baseline_value?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          evaluation_method?: string | null
          id?: string
          improvement_direction?: string
          indicator?: string | null
          notes?: string | null
          owner_user_id?: string | null
          related_aspect_id?: string | null
          status?: string
          target_date?: string | null
          target_value?: number | null
          tenant_id: string
          title: string
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          baseline_label?: string | null
          baseline_value?: number | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          evaluation_method?: string | null
          id?: string
          improvement_direction?: string
          indicator?: string | null
          notes?: string | null
          owner_user_id?: string | null
          related_aspect_id?: string | null
          status?: string
          target_date?: string | null
          target_value?: number | null
          tenant_id?: string
          title?: string
          unit?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "environmental_objectives_related_aspect_id_fkey"
            columns: ["related_aspect_id"]
            isOneToOne: false
            referencedRelation: "environmental_aspects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "environmental_objectives_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_checklist_items: {
        Row: {
          created_at: string
          critical: boolean
          help_text: string | null
          id: string
          photo_required: boolean
          prompt: string
          required: boolean
          response_type: string
          section: string
          sort_order: number
          template_id: string
        }
        Insert: {
          created_at?: string
          critical?: boolean
          help_text?: string | null
          id?: string
          photo_required?: boolean
          prompt: string
          required?: boolean
          response_type?: string
          section: string
          sort_order?: number
          template_id: string
        }
        Update: {
          created_at?: string
          critical?: boolean
          help_text?: string | null
          id?: string
          photo_required?: boolean
          prompt?: string
          required?: boolean
          response_type?: string
          section?: string
          sort_order?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_checklist_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "equipment_checklist_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_checklist_templates: {
        Row: {
          created_at: string
          created_by: string | null
          effective_at: string
          equipment_family: string
          id: string
          library_scope: string
          osha_basis: string | null
          status: string
          tenant_id: string | null
          title: string
          updated_at: string
          version_number: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          equipment_family: string
          id?: string
          library_scope?: string
          osha_basis?: string | null
          status?: string
          tenant_id?: string | null
          title: string
          updated_at?: string
          version_number?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_at?: string
          equipment_family?: string
          id?: string
          library_scope?: string
          osha_basis?: string | null
          status?: string
          tenant_id?: string | null
          title?: string
          updated_at?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "equipment_checklist_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_defects: {
        Row: {
          assigned_to: string | null
          component: string | null
          created_at: string
          created_by: string | null
          description: string
          due_at: string | null
          equipment_record_id: string
          facility_id: string | null
          first_seen_at: string
          id: string
          inspection_id: string | null
          item_id: string | null
          last_seen_at: string
          out_of_service: boolean
          severity: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          component?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_at?: string | null
          equipment_record_id: string
          facility_id?: string | null
          first_seen_at?: string
          id?: string
          inspection_id?: string | null
          item_id?: string | null
          last_seen_at?: string
          out_of_service?: boolean
          severity?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          component?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_at?: string | null
          equipment_record_id?: string
          facility_id?: string | null
          first_seen_at?: string
          id?: string
          inspection_id?: string | null
          item_id?: string | null
          last_seen_at?: string
          out_of_service?: boolean
          severity?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_defects_equipment_record_id_fkey"
            columns: ["equipment_record_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_defects_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_defects_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "equipment_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_defects_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "equipment_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_defects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_evidence: {
        Row: {
          ai_review_status: string
          caption: string | null
          captured_at: string
          component: string | null
          created_at: string
          equipment_record_id: string | null
          evidence_kind: string
          id: string
          media_kind: string
          source_id: string
          source_type: string
          storage_path: string
          tenant_id: string
          uploaded_by: string | null
        }
        Insert: {
          ai_review_status?: string
          caption?: string | null
          captured_at?: string
          component?: string | null
          created_at?: string
          equipment_record_id?: string | null
          evidence_kind?: string
          id?: string
          media_kind?: string
          source_id: string
          source_type: string
          storage_path: string
          tenant_id: string
          uploaded_by?: string | null
        }
        Update: {
          ai_review_status?: string
          caption?: string | null
          captured_at?: string
          component?: string | null
          created_at?: string
          equipment_record_id?: string | null
          evidence_kind?: string
          id?: string
          media_kind?: string
          source_id?: string
          source_type?: string
          storage_path?: string
          tenant_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_evidence_equipment_record_id_fkey"
            columns: ["equipment_record_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_evidence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_inspection_responses: {
        Row: {
          action_decision: string | null
          created_at: string
          id: string
          inspection_id: string
          item_id: string
          notes: string | null
          numeric_value: number | null
          response: string
          severity: string | null
          tenant_id: string
        }
        Insert: {
          action_decision?: string | null
          created_at?: string
          id?: string
          inspection_id: string
          item_id: string
          notes?: string | null
          numeric_value?: number | null
          response: string
          severity?: string | null
          tenant_id: string
        }
        Update: {
          action_decision?: string | null
          created_at?: string
          id?: string
          inspection_id?: string
          item_id?: string
          notes?: string | null
          numeric_value?: number | null
          response?: string
          severity?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_inspection_responses_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "equipment_inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_inspection_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "equipment_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_inspection_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_inspections: {
        Row: {
          checklist_template_id: string
          client_context: Json
          created_at: string
          duration_seconds: number | null
          equipment_id: string
          equipment_record_id: string
          facility_id: string | null
          failed_critical_count: number
          failed_item_count: number
          hour_meter: number | null
          id: string
          location_label: string | null
          operator_attestation: boolean
          operator_id: string
          readiness_result: string
          shift_label: string | null
          signature_name: string | null
          started_at: string
          submitted_at: string
          tenant_id: string
        }
        Insert: {
          checklist_template_id: string
          client_context?: Json
          created_at?: string
          duration_seconds?: number | null
          equipment_id: string
          equipment_record_id: string
          facility_id?: string | null
          failed_critical_count?: number
          failed_item_count?: number
          hour_meter?: number | null
          id?: string
          location_label?: string | null
          operator_attestation?: boolean
          operator_id: string
          readiness_result?: string
          shift_label?: string | null
          signature_name?: string | null
          started_at?: string
          submitted_at?: string
          tenant_id: string
        }
        Update: {
          checklist_template_id?: string
          client_context?: Json
          created_at?: string
          duration_seconds?: number | null
          equipment_id?: string
          equipment_record_id?: string
          facility_id?: string | null
          failed_critical_count?: number
          failed_item_count?: number
          hour_meter?: number | null
          id?: string
          location_label?: string | null
          operator_attestation?: boolean
          operator_id?: string
          readiness_result?: string
          shift_label?: string | null
          signature_name?: string | null
          started_at?: string
          submitted_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_inspections_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "equipment_checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_inspections_equipment_record_id_fkey"
            columns: ["equipment_record_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_inspections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_missed_inspection_rules: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          department: string | null
          due_time_local: string
          equipment_family: string | null
          equipment_record_id: string | null
          escalation_user_ids: string[]
          grace_minutes: number
          id: string
          last_reminded_at: string | null
          shift_label: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          department?: string | null
          due_time_local?: string
          equipment_family?: string | null
          equipment_record_id?: string | null
          escalation_user_ids?: string[]
          grace_minutes?: number
          id?: string
          last_reminded_at?: string | null
          shift_label?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          department?: string | null
          due_time_local?: string
          equipment_family?: string | null
          equipment_record_id?: string | null
          escalation_user_ids?: string[]
          grace_minutes?: number
          id?: string
          last_reminded_at?: string | null
          shift_label?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_missed_inspection_rules_equipment_record_id_fkey"
            columns: ["equipment_record_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_missed_inspection_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_operator_authorizations: {
        Row: {
          authorization_source: string | null
          created_at: string
          equipment_family: string
          evaluation_due_at: string | null
          evaluator_name: string | null
          expires_at: string | null
          id: string
          issued_at: string
          member_id: string
          site_label: string | null
          status: string
          tenant_id: string
          trainer_name: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          authorization_source?: string | null
          created_at?: string
          equipment_family: string
          evaluation_due_at?: string | null
          evaluator_name?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          member_id: string
          site_label?: string | null
          status?: string
          tenant_id: string
          trainer_name?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          authorization_source?: string | null
          created_at?: string
          equipment_family?: string
          evaluation_due_at?: string | null
          evaluator_name?: string | null
          expires_at?: string | null
          id?: string
          issued_at?: string
          member_id?: string
          site_label?: string | null
          status?: string
          tenant_id?: string
          trainer_name?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_operator_authorizations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_operator_authorizations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_operator_authorizations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "equipment_operator_authorizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_repairs: {
        Row: {
          completed_at: string | null
          created_at: string
          defect_id: string
          facility_id: string | null
          id: string
          mechanic_id: string | null
          repair_notes: string | null
          return_to_service_at: string | null
          return_to_service_by: string | null
          return_to_service_notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          defect_id: string
          facility_id?: string | null
          id?: string
          mechanic_id?: string | null
          repair_notes?: string | null
          return_to_service_at?: string | null
          return_to_service_by?: string | null
          return_to_service_notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          defect_id?: string
          facility_id?: string | null
          id?: string
          mechanic_id?: string | null
          repair_notes?: string | null
          return_to_service_at?: string | null
          return_to_service_by?: string | null
          return_to_service_notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_repairs_defect_id_fkey"
            columns: ["defect_id"]
            isOneToOne: false
            referencedRelation: "equipment_defects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_repairs_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_repairs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      facilities: {
        Row: {
          address: string | null
          city: string | null
          code: string | null
          created_at: string
          id: string
          is_primary: boolean
          latitude: number | null
          longitude: number | null
          name: string
          settings: Json
          state: string | null
          status: string
          tenant_id: string
          updated_at: string
          weather_timezone: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          latitude?: number | null
          longitude?: number | null
          name: string
          settings?: Json
          state?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          weather_timezone?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          code?: string | null
          created_at?: string
          id?: string
          is_primary?: boolean
          latitude?: number | null
          longitude?: number | null
          name?: string
          settings?: Json
          state?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          weather_timezone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facilities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_driver_profiles: {
        Row: {
          created_at: string
          created_by: string | null
          defensive_training_at: string | null
          endorsements: string[]
          hazmat_endorsement: boolean
          hazmat_endorsement_expires_at: string | null
          id: string
          license_class: string | null
          license_expires_at: string | null
          license_number: string | null
          license_state: string | null
          medical_card_expires_at: string | null
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          worker_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defensive_training_at?: string | null
          endorsements?: string[]
          hazmat_endorsement?: boolean
          hazmat_endorsement_expires_at?: string | null
          id?: string
          license_class?: string | null
          license_expires_at?: string | null
          license_number?: string | null
          license_state?: string | null
          medical_card_expires_at?: string | null
          notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          worker_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defensive_training_at?: string | null
          endorsements?: string[]
          hazmat_endorsement?: boolean
          hazmat_endorsement_expires_at?: string | null
          id?: string
          license_class?: string | null
          license_expires_at?: string | null
          license_number?: string | null
          license_state?: string | null
          medical_card_expires_at?: string | null
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_driver_profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_driver_profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_driver_profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_driver_profiles_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "fleet_driver_profiles_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_motor_vehicle_incidents: {
        Row: {
          created_at: string
          created_by: string | null
          driver_id: string | null
          id: string
          incident_id: string
          journey_id: string | null
          notes: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          incident_id: string
          journey_id?: string | null
          notes?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          incident_id?: string
          journey_id?: string | null
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_motor_vehicle_incidents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_motor_vehicle_incidents_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "fleet_driver_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_motor_vehicle_incidents_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_motor_vehicle_incidents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_motor_vehicle_incidents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_motor_vehicle_incidents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicle_chemicals: {
        Row: {
          chemical_product_id: string
          created_at: string
          created_by: string | null
          id: string
          max_quantity: number | null
          notes: string | null
          quantity_unit: string | null
          tenant_id: string
          un_number: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          chemical_product_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_quantity?: number | null
          notes?: string | null
          quantity_unit?: string | null
          tenant_id: string
          un_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          chemical_product_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          max_quantity?: number | null
          notes?: string | null
          quantity_unit?: string | null
          tenant_id?: string
          un_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicle_chemicals_chemical_product_id_fkey"
            columns: ["chemical_product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_chemicals_chemical_product_id_fkey"
            columns: ["chemical_product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "fleet_vehicle_chemicals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_chemicals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_chemicals_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_chemicals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicle_documents: {
        Row: {
          created_at: string
          created_by: string | null
          doc_type: string
          expires_at: string | null
          file_name: string | null
          file_path: string | null
          id: string
          issued_at: string | null
          mime_type: string | null
          notes: string | null
          reference: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          doc_type: string
          expires_at?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          issued_at?: string | null
          mime_type?: string | null
          notes?: string | null
          reference?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          doc_type?: string
          expires_at?: string | null
          file_name?: string | null
          file_path?: string | null
          id?: string
          issued_at?: string | null
          mime_type?: string | null
          notes?: string | null
          reference?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicle_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_documents_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicle_inspections: {
        Row: {
          created_at: string
          created_by: string | null
          defects_noted: string | null
          driver_id: string | null
          id: string
          inspection_type: string
          items: Json
          odometer_miles: number | null
          passed: boolean
          performed_at: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          defects_noted?: string | null
          driver_id?: string | null
          id?: string
          inspection_type?: string
          items?: Json
          odometer_miles?: number | null
          passed?: boolean
          performed_at?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          defects_noted?: string | null
          driver_id?: string | null
          id?: string
          inspection_type?: string
          items?: Json
          odometer_miles?: number | null
          passed?: boolean
          performed_at?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicle_inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_inspections_driver_id_fkey"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "fleet_driver_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_inspections_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_inspections_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicle_placards: {
        Row: {
          created_at: string
          created_by: string | null
          division: string | null
          hazard_class: string
          id: string
          notes: string | null
          placard_label: string | null
          proper_shipping_name: string | null
          tenant_id: string
          un_number: string | null
          updated_at: string
          updated_by: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          division?: string | null
          hazard_class: string
          id?: string
          notes?: string | null
          placard_label?: string | null
          proper_shipping_name?: string | null
          tenant_id: string
          un_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          division?: string | null
          hazard_class?: string
          id?: string
          notes?: string | null
          placard_label?: string | null
          proper_shipping_name?: string | null
          tenant_id?: string
          un_number?: string | null
          updated_at?: string
          updated_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicle_placards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_placards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_placards_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicle_placards_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "fleet_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_vehicles: {
        Row: {
          annual_dot_inspection_at: string | null
          assigned_driver_id: string | null
          carries_hazmat: boolean
          created_at: string
          created_by: string | null
          dot_vehicle_class: string | null
          fuel_type: string | null
          gvwr_lbs: number | null
          hazmat_notes: string | null
          home_location_text: string | null
          id: string
          ifta_registered: boolean
          license_plate: string | null
          license_plate_state: string | null
          make: string | null
          mc_number: string | null
          model: string | null
          model_year: number | null
          notes: string | null
          odometer_miles: number | null
          photo_path: string | null
          status: string
          tenant_id: string
          unit_number: string | null
          updated_at: string
          updated_by: string | null
          usdot_number: string | null
          vehicle_type: string
          vin: string | null
        }
        Insert: {
          annual_dot_inspection_at?: string | null
          assigned_driver_id?: string | null
          carries_hazmat?: boolean
          created_at?: string
          created_by?: string | null
          dot_vehicle_class?: string | null
          fuel_type?: string | null
          gvwr_lbs?: number | null
          hazmat_notes?: string | null
          home_location_text?: string | null
          id?: string
          ifta_registered?: boolean
          license_plate?: string | null
          license_plate_state?: string | null
          make?: string | null
          mc_number?: string | null
          model?: string | null
          model_year?: number | null
          notes?: string | null
          odometer_miles?: number | null
          photo_path?: string | null
          status?: string
          tenant_id: string
          unit_number?: string | null
          updated_at?: string
          updated_by?: string | null
          usdot_number?: string | null
          vehicle_type?: string
          vin?: string | null
        }
        Update: {
          annual_dot_inspection_at?: string | null
          assigned_driver_id?: string | null
          carries_hazmat?: boolean
          created_at?: string
          created_by?: string | null
          dot_vehicle_class?: string | null
          fuel_type?: string | null
          gvwr_lbs?: number | null
          hazmat_notes?: string | null
          home_location_text?: string | null
          id?: string
          ifta_registered?: boolean
          license_plate?: string | null
          license_plate_state?: string | null
          make?: string | null
          mc_number?: string | null
          model?: string | null
          model_year?: number | null
          notes?: string | null
          odometer_miles?: number | null
          photo_path?: string | null
          status?: string
          tenant_id?: string
          unit_number?: string | null
          updated_at?: string
          updated_by?: string | null
          usdot_number?: string | null
          vehicle_type?: string
          vin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fleet_vehicles_assigned_driver_id_fkey"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "fleet_driver_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fleet_vehicles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ghs_pictogram_catalog: {
        Row: {
          code: string
          created_at: string
          default_signal_word: string | null
          hazard_class_summary: string | null
          image_path: string
          name: string
          sort_order: number
          symbol_description: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_signal_word?: string | null
          hazard_class_summary?: string | null
          image_path: string
          name: string
          sort_order: number
          symbol_description: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_signal_word?: string | null
          hazard_class_summary?: string | null
          image_path?: string
          name?: string
          sort_order?: number
          symbol_description?: string
          updated_at?: string
        }
        Relationships: []
      }
      hazardous_waste_areas: {
        Row: {
          archived_at: string | null
          area_type: string
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          location_notes: string | null
          name: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          weekly_cadence_days: number
        }
        Insert: {
          archived_at?: string | null
          area_type: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          location_notes?: string | null
          name: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          weekly_cadence_days?: number
        }
        Update: {
          archived_at?: string | null
          area_type?: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          location_notes?: string | null
          name?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          weekly_cadence_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "hazardous_waste_areas_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_areas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hazardous_waste_containers: {
        Row: {
          accumulation_started_at: string | null
          archived_at: string | null
          area_location: string | null
          area_type: string
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          label: string
          notes: string | null
          status: string
          stream_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          volume_quantity: number | null
          volume_unit: string | null
        }
        Insert: {
          accumulation_started_at?: string | null
          archived_at?: string | null
          area_location?: string | null
          area_type: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          label: string
          notes?: string | null
          status?: string
          stream_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          volume_quantity?: number | null
          volume_unit?: string | null
        }
        Update: {
          accumulation_started_at?: string | null
          archived_at?: string | null
          area_location?: string | null
          area_type?: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          label?: string
          notes?: string | null
          status?: string
          stream_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          volume_quantity?: number | null
          volume_unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hazardous_waste_containers_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_containers_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "hazardous_waste_streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_containers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hazardous_waste_inspections: {
        Row: {
          area_id: string
          area_type: string
          container_label: string | null
          created_at: string
          created_by: string | null
          critical_failures: number
          facility_id: string | null
          findings: Json
          id: string
          inspected_at: string
          inspected_by: string | null
          observations: string | null
          passing_checks: number
          photo_urls: string[]
          status: string
          tenant_id: string
          total_checks: number
          updated_at: string
          updated_by: string | null
          waste_description: string | null
        }
        Insert: {
          area_id: string
          area_type: string
          container_label?: string | null
          created_at?: string
          created_by?: string | null
          critical_failures?: number
          facility_id?: string | null
          findings?: Json
          id?: string
          inspected_at?: string
          inspected_by?: string | null
          observations?: string | null
          passing_checks?: number
          photo_urls?: string[]
          status?: string
          tenant_id: string
          total_checks?: number
          updated_at?: string
          updated_by?: string | null
          waste_description?: string | null
        }
        Update: {
          area_id?: string
          area_type?: string
          container_label?: string | null
          created_at?: string
          created_by?: string | null
          critical_failures?: number
          facility_id?: string | null
          findings?: Json
          id?: string
          inspected_at?: string
          inspected_by?: string | null
          observations?: string | null
          passing_checks?: number
          photo_urls?: string[]
          status?: string
          tenant_id?: string
          total_checks?: number
          updated_at?: string
          updated_by?: string | null
          waste_description?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hazardous_waste_inspections_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "hazardous_waste_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_inspections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hazardous_waste_label_prints: {
        Row: {
          area_id: string | null
          byte_size: number | null
          container_id: string | null
          field_snapshot: Json
          filename: string
          id: string
          printed_at: string
          printed_by: string | null
          size_key: string
          stream_id: string
          template: string
          tenant_id: string
        }
        Insert: {
          area_id?: string | null
          byte_size?: number | null
          container_id?: string | null
          field_snapshot: Json
          filename: string
          id?: string
          printed_at?: string
          printed_by?: string | null
          size_key: string
          stream_id: string
          template: string
          tenant_id: string
        }
        Update: {
          area_id?: string | null
          byte_size?: number | null
          container_id?: string | null
          field_snapshot?: Json
          filename?: string
          id?: string
          printed_at?: string
          printed_by?: string | null
          size_key?: string
          stream_id?: string
          template?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hazardous_waste_label_prints_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "hazardous_waste_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_label_prints_container_id_fkey"
            columns: ["container_id"]
            isOneToOne: false
            referencedRelation: "hazardous_waste_containers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_label_prints_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "hazardous_waste_streams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_label_prints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      hazardous_waste_streams: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          determination_basis: string | null
          dot_hazard_class: string | null
          dot_packing_group: string | null
          dot_proper_shipping_name: string | null
          dot_un_number: string | null
          facility_id: string | null
          generating_process: string | null
          generator_category: string
          ghs_pictograms: string[]
          ghs_signal_word: string | null
          hazards: string[]
          id: string
          long_haul: boolean
          name: string
          nfpa_flammability: number | null
          nfpa_health: number | null
          nfpa_instability: number | null
          nfpa_special: string | null
          notes: string | null
          owner_user_id: string | null
          physical_state: string | null
          review_due_date: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          waste_codes: string[]
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          determination_basis?: string | null
          dot_hazard_class?: string | null
          dot_packing_group?: string | null
          dot_proper_shipping_name?: string | null
          dot_un_number?: string | null
          facility_id?: string | null
          generating_process?: string | null
          generator_category?: string
          ghs_pictograms?: string[]
          ghs_signal_word?: string | null
          hazards?: string[]
          id?: string
          long_haul?: boolean
          name: string
          nfpa_flammability?: number | null
          nfpa_health?: number | null
          nfpa_instability?: number | null
          nfpa_special?: string | null
          notes?: string | null
          owner_user_id?: string | null
          physical_state?: string | null
          review_due_date?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          waste_codes?: string[]
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          determination_basis?: string | null
          dot_hazard_class?: string | null
          dot_packing_group?: string | null
          dot_proper_shipping_name?: string | null
          dot_un_number?: string | null
          facility_id?: string | null
          generating_process?: string | null
          generator_category?: string
          ghs_pictograms?: string[]
          ghs_signal_word?: string | null
          hazards?: string[]
          id?: string
          long_haul?: boolean
          name?: string
          nfpa_flammability?: number | null
          nfpa_health?: number | null
          nfpa_instability?: number | null
          nfpa_special?: string | null
          notes?: string | null
          owner_user_id?: string | null
          physical_state?: string | null
          review_due_date?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          waste_codes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "hazardous_waste_streams_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hazardous_waste_streams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_actions: {
        Row: {
          action_type: string
          cancel_reason: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string | null
          description: string
          due_at: string | null
          hierarchy_of_controls: string | null
          id: string
          incident_id: string
          owner_user_id: string | null
          source_ecfa_node_id: string | null
          source_rca_node_id: string | null
          source_thread_id: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          verification_evidence: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          action_type: string
          cancel_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          due_at?: string | null
          hierarchy_of_controls?: string | null
          id?: string
          incident_id: string
          owner_user_id?: string | null
          source_ecfa_node_id?: string | null
          source_rca_node_id?: string | null
          source_thread_id?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          verification_evidence?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          action_type?: string
          cancel_reason?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          due_at?: string | null
          hierarchy_of_controls?: string | null
          id?: string
          incident_id?: string
          owner_user_id?: string | null
          source_ecfa_node_id?: string | null
          source_rca_node_id?: string | null
          source_thread_id?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          verification_evidence?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_actions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_actions_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "safety_board_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_actions_source_thread_id_fkey"
            columns: ["source_thread_id"]
            isOneToOne: false
            referencedRelation: "safety_board_trending"
            referencedColumns: ["thread_id"]
          },
          {
            foreignKeyName: "incident_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_anon_intake_tokens: {
        Row: {
          auto_route_enabled: boolean
          created_at: string
          created_by: string | null
          default_assigned_investigator: string | null
          enabled: boolean
          geofence_radius_m: number | null
          id: string
          label: string
          last_used_at: string | null
          rate_limit_per_hour: number | null
          require_captcha: boolean
          site_geo_lat: number | null
          site_geo_lng: number | null
          tenant_id: string
          token: string
          total_reports: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_route_enabled?: boolean
          created_at?: string
          created_by?: string | null
          default_assigned_investigator?: string | null
          enabled?: boolean
          geofence_radius_m?: number | null
          id?: string
          label: string
          last_used_at?: string | null
          rate_limit_per_hour?: number | null
          require_captcha?: boolean
          site_geo_lat?: number | null
          site_geo_lng?: number | null
          tenant_id: string
          token: string
          total_reports?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_route_enabled?: boolean
          created_at?: string
          created_by?: string | null
          default_assigned_investigator?: string | null
          enabled?: boolean
          geofence_radius_m?: number | null
          id?: string
          label?: string
          last_used_at?: string | null
          rate_limit_per_hour?: number | null
          require_captcha?: boolean
          site_geo_lat?: number | null
          site_geo_lng?: number | null
          tenant_id?: string
          token?: string
          total_reports?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_anon_intake_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_attachments: {
        Row: {
          caption: string | null
          exif_json: Json | null
          file_size_bytes: number | null
          id: string
          incident_id: string
          mime_type: string | null
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          exif_json?: Json | null
          file_size_bytes?: number | null
          id?: string
          incident_id: string
          mime_type?: string | null
          storage_path: string
          tenant_id: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          exif_json?: Json | null
          file_size_bytes?: number | null
          id?: string
          incident_id?: string
          mime_type?: string | null
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_attachments_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          after_row: Json | null
          before_row: Json | null
          context: string | null
          event_type: string
          id: number
          incident_id: string
          occurred_at: string
          tenant_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type: string
          id?: number
          incident_id: string
          occurred_at?: string
          tenant_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type?: string
          id?: number
          incident_id?: string
          occurred_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_capas: {
        Row: {
          assigned_to_user_id: string | null
          completed_at: string | null
          completed_by_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          description: string
          due_at: string | null
          facility_id: string | null
          hierarchy_level: string
          id: string
          incident_id: string
          status: string
          tenant_id: string
          updated_at: string
          verification_notes: string | null
          verified_by_user_id: string | null
          verified_effective_at: string | null
        }
        Insert: {
          assigned_to_user_id?: string | null
          completed_at?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description: string
          due_at?: string | null
          facility_id?: string | null
          hierarchy_level: string
          id?: string
          incident_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          verification_notes?: string | null
          verified_by_user_id?: string | null
          verified_effective_at?: string | null
        }
        Update: {
          assigned_to_user_id?: string | null
          completed_at?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string
          due_at?: string | null
          facility_id?: string | null
          hierarchy_level?: string
          id?: string
          incident_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_notes?: string | null
          verified_by_user_id?: string | null
          verified_effective_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_capas_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_capas_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_capas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_care_cases: {
        Row: {
          case_manager_user_id: string | null
          case_status: string
          clinic_name: string | null
          created_at: string
          created_by: string | null
          days_away_from_work: number
          days_lost: number
          days_restricted: number
          diagnosis: string | null
          drug_test_at: string | null
          drug_test_notes: string | null
          drug_test_status: string | null
          id: string
          incident_id: string
          initial_visit_at: string | null
          modified_duty_end: string | null
          modified_duty_start: string | null
          next_followup_at: string | null
          person_id: string | null
          restrictions: string[]
          return_to_work_at: string | null
          tenant_id: string
          treating_physician: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          case_manager_user_id?: string | null
          case_status?: string
          clinic_name?: string | null
          created_at?: string
          created_by?: string | null
          days_away_from_work?: number
          days_lost?: number
          days_restricted?: number
          diagnosis?: string | null
          drug_test_at?: string | null
          drug_test_notes?: string | null
          drug_test_status?: string | null
          id?: string
          incident_id: string
          initial_visit_at?: string | null
          modified_duty_end?: string | null
          modified_duty_start?: string | null
          next_followup_at?: string | null
          person_id?: string | null
          restrictions?: string[]
          return_to_work_at?: string | null
          tenant_id: string
          treating_physician?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          case_manager_user_id?: string | null
          case_status?: string
          clinic_name?: string | null
          created_at?: string
          created_by?: string | null
          days_away_from_work?: number
          days_lost?: number
          days_restricted?: number
          diagnosis?: string | null
          drug_test_at?: string | null
          drug_test_notes?: string | null
          drug_test_status?: string | null
          id?: string
          incident_id?: string
          initial_visit_at?: string | null
          modified_duty_end?: string | null
          modified_duty_start?: string | null
          next_followup_at?: string | null
          person_id?: string | null
          restrictions?: string[]
          return_to_work_at?: string | null
          tenant_id?: string
          treating_physician?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_care_cases_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_care_cases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "incident_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_care_cases_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "incident_people_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_care_cases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_care_visits: {
        Row: {
          attachments_count: number
          care_case_id: string
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          tenant_id: string
          visit_at: string
          visit_type: string
        }
        Insert: {
          attachments_count?: number
          care_case_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          tenant_id: string
          visit_at?: string
          visit_type?: string
        }
        Update: {
          attachments_count?: number
          care_case_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          tenant_id?: string
          visit_at?: string
          visit_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_care_visits_care_case_id_fkey"
            columns: ["care_case_id"]
            isOneToOne: false
            referencedRelation: "incident_care_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_care_visits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_classifications: {
        Row: {
          ai_confidence: number | null
          ai_suggested_classification: string | null
          classification: string | null
          classified_at: string
          classified_by: string | null
          decision_path: Json
          human_overrode_ai: boolean
          id: string
          incident_id: string
          is_new_case: boolean
          is_privacy_case: boolean
          is_work_related: boolean
          meets_recording_criteria: boolean
          override_reason: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_suggested_classification?: string | null
          classification?: string | null
          classified_at?: string
          classified_by?: string | null
          decision_path?: Json
          human_overrode_ai?: boolean
          id?: string
          incident_id: string
          is_new_case: boolean
          is_privacy_case?: boolean
          is_work_related: boolean
          meets_recording_criteria: boolean
          override_reason?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_suggested_classification?: string | null
          classification?: string | null
          classified_at?: string
          classified_by?: string | null
          decision_path?: Json
          human_overrode_ai?: boolean
          id?: string
          incident_id?: string
          is_new_case?: boolean
          is_privacy_case?: boolean
          is_work_related?: boolean
          meets_recording_criteria?: boolean
          override_reason?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_classifications_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_classifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_ecfa_ai_suggestions: {
        Row: {
          accepted: boolean
          created_at: string
          created_by: string | null
          id: string
          investigation_id: string
          mode: string
          model: string
          suggestion: Json
          tenant_id: string
        }
        Insert: {
          accepted?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          investigation_id: string
          mode: string
          model: string
          suggestion: Json
          tenant_id: string
        }
        Update: {
          accepted?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          investigation_id?: string
          mode?: string
          model?: string
          suggestion?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_ecfa_ai_suggestions_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "incident_investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_ecfa_ai_suggestions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_ecfa_nodes: {
        Row: {
          ai_edited: boolean
          ai_origin: boolean
          cf_category: string | null
          cf_hierarchy_control: string | null
          created_at: string
          created_by: string | null
          description: string | null
          failed_barrier: string | null
          id: string
          investigation_id: string
          is_causal_factor: boolean
          lane: string | null
          node_type: string
          occurred_at: string | null
          parent_event_id: string | null
          sequence_index: number
          tenant_id: string
          title: string
          updated_at: string
          verification_status: string
        }
        Insert: {
          ai_edited?: boolean
          ai_origin?: boolean
          cf_category?: string | null
          cf_hierarchy_control?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          failed_barrier?: string | null
          id?: string
          investigation_id: string
          is_causal_factor?: boolean
          lane?: string | null
          node_type: string
          occurred_at?: string | null
          parent_event_id?: string | null
          sequence_index?: number
          tenant_id: string
          title: string
          updated_at?: string
          verification_status?: string
        }
        Update: {
          ai_edited?: boolean
          ai_origin?: boolean
          cf_category?: string | null
          cf_hierarchy_control?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          failed_barrier?: string | null
          id?: string
          investigation_id?: string
          is_causal_factor?: boolean
          lane?: string | null
          node_type?: string
          occurred_at?: string | null
          parent_event_id?: string | null
          sequence_index?: number
          tenant_id?: string
          title?: string
          updated_at?: string
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_ecfa_nodes_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "incident_investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_ecfa_nodes_parent_event_id_fkey"
            columns: ["parent_event_id"]
            isOneToOne: false
            referencedRelation: "incident_ecfa_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_ecfa_nodes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_investigations: {
        Row: {
          began_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          id: string
          immediate_causes: string | null
          incident_id: string
          lead_investigator: string | null
          lesson_published_at: string | null
          lesson_published_by: string | null
          lesson_summary: string | null
          lessons_learned: string | null
          publish_lesson: boolean
          rca_method: string
          root_causes: string | null
          scope_summary: string | null
          sequence_of_events: string | null
          signoff_at: string | null
          signoff_by: string | null
          signoff_typed_name: string | null
          target_close_at: string | null
          team_member_ids: string[]
          tenant_id: string
          underlying_causes: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          began_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          immediate_causes?: string | null
          incident_id: string
          lead_investigator?: string | null
          lesson_published_at?: string | null
          lesson_published_by?: string | null
          lesson_summary?: string | null
          lessons_learned?: string | null
          publish_lesson?: boolean
          rca_method?: string
          root_causes?: string | null
          scope_summary?: string | null
          sequence_of_events?: string | null
          signoff_at?: string | null
          signoff_by?: string | null
          signoff_typed_name?: string | null
          target_close_at?: string | null
          team_member_ids?: string[]
          tenant_id: string
          underlying_causes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          began_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          immediate_causes?: string | null
          incident_id?: string
          lead_investigator?: string | null
          lesson_published_at?: string | null
          lesson_published_by?: string | null
          lesson_summary?: string | null
          lessons_learned?: string | null
          publish_lesson?: boolean
          rca_method?: string
          root_causes?: string | null
          scope_summary?: string | null
          sequence_of_events?: string | null
          signoff_at?: string | null
          signoff_by?: string | null
          signoff_typed_name?: string | null
          target_close_at?: string | null
          team_member_ids?: string[]
          tenant_id?: string
          underlying_causes?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_investigations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: true
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_investigations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_medical_authorizations: {
        Row: {
          authorization_type: string
          created_at: string
          created_by: string | null
          effective_at: string | null
          expires_at: string | null
          id: string
          incident_id: string
          person_id: string | null
          revoked_at: string | null
          scope: string[]
          signatory_name: string | null
          signatory_relation: string | null
          signed_at: string | null
          storage_path: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          authorization_type: string
          created_at?: string
          created_by?: string | null
          effective_at?: string | null
          expires_at?: string | null
          id?: string
          incident_id: string
          person_id?: string | null
          revoked_at?: string | null
          scope?: string[]
          signatory_name?: string | null
          signatory_relation?: string | null
          signed_at?: string | null
          storage_path?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          authorization_type?: string
          created_at?: string
          created_by?: string | null
          effective_at?: string | null
          expires_at?: string | null
          id?: string
          incident_id?: string
          person_id?: string | null
          revoked_at?: string | null
          scope?: string[]
          signatory_name?: string | null
          signatory_relation?: string | null
          signed_at?: string | null
          storage_path?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_medical_authorizations_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_medical_authorizations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "incident_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_medical_authorizations_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "incident_people_safe"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_medical_authorizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_medical_documents: {
        Row: {
          caption: string | null
          care_case_id: string | null
          created_at: string
          created_by: string | null
          doc_type: string
          file_size_bytes: number | null
          id: string
          incident_id: string
          mime_type: string | null
          storage_path: string
          tenant_id: string
        }
        Insert: {
          caption?: string | null
          care_case_id?: string | null
          created_at?: string
          created_by?: string | null
          doc_type: string
          file_size_bytes?: number | null
          id?: string
          incident_id: string
          mime_type?: string | null
          storage_path: string
          tenant_id: string
        }
        Update: {
          caption?: string | null
          care_case_id?: string | null
          created_at?: string
          created_by?: string | null
          doc_type?: string
          file_size_bytes?: number | null
          id?: string
          incident_id?: string
          mime_type?: string | null
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_medical_documents_care_case_id_fkey"
            columns: ["care_case_id"]
            isOneToOne: false
            referencedRelation: "incident_care_cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_medical_documents_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_medical_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_notification_rules: {
        Row: {
          channels: string[]
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          escalation_minutes: number | null
          facility_id: string | null
          id: string
          match_incident_type: string[] | null
          match_recordable: boolean | null
          match_severity_actual: string[] | null
          match_severity_potential: string[] | null
          name: string
          notify_emails: string[] | null
          notify_roles: string[] | null
          notify_user_ids: string[] | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channels?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          escalation_minutes?: number | null
          facility_id?: string | null
          id?: string
          match_incident_type?: string[] | null
          match_recordable?: boolean | null
          match_severity_actual?: string[] | null
          match_severity_potential?: string[] | null
          name: string
          notify_emails?: string[] | null
          notify_roles?: string[] | null
          notify_user_ids?: string[] | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channels?: string[]
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          escalation_minutes?: number | null
          facility_id?: string | null
          id?: string
          match_incident_type?: string[] | null
          match_recordable?: boolean | null
          match_severity_actual?: string[] | null
          match_severity_potential?: string[] | null
          name?: string
          notify_emails?: string[] | null
          notify_roles?: string[] | null
          notify_user_ids?: string[] | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_notification_rules_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_notification_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_notifications: {
        Row: {
          channel: string
          error_text: string | null
          id: number
          incident_id: string
          provider_id: string | null
          recipient_email: string | null
          recipient_phone: string | null
          recipient_user_id: string | null
          rule_id: string | null
          sent_at: string
          status: string
          tenant_id: string
          trigger_type: string
        }
        Insert: {
          channel: string
          error_text?: string | null
          id?: number
          incident_id: string
          provider_id?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_user_id?: string | null
          rule_id?: string | null
          sent_at?: string
          status: string
          tenant_id: string
          trigger_type?: string
        }
        Update: {
          channel?: string
          error_text?: string | null
          id?: number
          incident_id?: string
          provider_id?: string | null
          recipient_email?: string | null
          recipient_phone?: string | null
          recipient_user_id?: string | null
          rule_id?: string | null
          sent_at?: string
          status?: string
          tenant_id?: string
          trigger_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_notifications_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_notifications_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "incident_notification_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "incident_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_people: {
        Row: {
          body_part: string[] | null
          created_at: string
          date_of_birth: string | null
          email: string | null
          employment_type: string | null
          full_name: string | null
          gender: string | null
          hire_date: string | null
          home_address: string | null
          id: string
          incident_id: string
          injury_nature: string | null
          injury_source: string | null
          is_primary: boolean
          job_title: string | null
          person_role: string
          phone: string | null
          tenant_id: string
          treatment_facility: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          body_part?: string[] | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          employment_type?: string | null
          full_name?: string | null
          gender?: string | null
          hire_date?: string | null
          home_address?: string | null
          id?: string
          incident_id: string
          injury_nature?: string | null
          injury_source?: string | null
          is_primary?: boolean
          job_title?: string | null
          person_role: string
          phone?: string | null
          tenant_id: string
          treatment_facility?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          body_part?: string[] | null
          created_at?: string
          date_of_birth?: string | null
          email?: string | null
          employment_type?: string | null
          full_name?: string | null
          gender?: string | null
          hire_date?: string | null
          home_address?: string | null
          id?: string
          incident_id?: string
          injury_nature?: string | null
          injury_source?: string | null
          is_primary?: boolean
          job_title?: string | null
          person_role?: string
          phone?: string | null
          tenant_id?: string
          treatment_facility?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_people_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_people_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_predictions: {
        Row: {
          confidence: number
          id: string
          incident_id: string
          model: string
          predicted_at: string
          predicted_severity: string
          prompt_version: string
          raw_response: Json
          tenant_id: string
        }
        Insert: {
          confidence: number
          id?: string
          incident_id: string
          model: string
          predicted_at?: string
          predicted_severity: string
          prompt_version: string
          raw_response?: Json
          tenant_id: string
        }
        Update: {
          confidence?: number
          id?: string
          incident_id?: string
          model?: string
          predicted_at?: string
          predicted_severity?: string
          prompt_version?: string
          raw_response?: Json
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_predictions_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_predictions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_rca_5whys: {
        Row: {
          answer: string
          created_at: string
          id: string
          investigation_id: string
          is_root: boolean
          ordinal: number
          question: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          answer: string
          created_at?: string
          id?: string
          investigation_id: string
          is_root?: boolean
          ordinal: number
          question?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          answer?: string
          created_at?: string
          id?: string
          investigation_id?: string
          is_root?: boolean
          ordinal?: number
          question?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_rca_5whys_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "incident_investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_5whys_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_rca_fishbone: {
        Row: {
          category: string
          cause: string
          created_at: string
          id: string
          investigation_id: string
          is_root: boolean
          ordinal: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          category: string
          cause: string
          created_at?: string
          id?: string
          investigation_id: string
          is_root?: boolean
          ordinal?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          cause?: string
          created_at?: string
          id?: string
          investigation_id?: string
          is_root?: boolean
          ordinal?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_rca_fishbone_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "incident_investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_fishbone_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_rca_icam_factors: {
        Row: {
          created_at: string
          evidence: string | null
          factor: string
          id: string
          investigation_id: string
          is_root: boolean
          layer: string
          ordinal: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          evidence?: string | null
          factor: string
          id?: string
          investigation_id: string
          is_root?: boolean
          layer: string
          ordinal?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          evidence?: string | null
          factor?: string
          id?: string
          investigation_id?: string
          is_root?: boolean
          layer?: string
          ordinal?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_rca_icam_factors_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "incident_investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_icam_factors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_rca_taproot_factors: {
        Row: {
          created_at: string
          description: string
          factor_type: string
          id: string
          investigation_id: string
          is_root: boolean
          ordinal: number
          parent_id: string | null
          taproot_category: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          factor_type: string
          id?: string
          investigation_id: string
          is_root?: boolean
          ordinal?: number
          parent_id?: string | null
          taproot_category?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          factor_type?: string
          id?: string
          investigation_id?: string
          is_root?: boolean
          ordinal?: number
          parent_id?: string | null
          taproot_category?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incident_rca_taproot_factors_investigation_id_fkey"
            columns: ["investigation_id"]
            isOneToOne: false
            referencedRelation: "incident_investigations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_taproot_factors_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "incident_rca_taproot_factors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_rca_taproot_factors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_severe_injury_reports: {
        Row: {
          basis_at: string
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          incident_id: string
          notes: string | null
          osha_case_number: string | null
          report_method: string | null
          reported_at: string | null
          reported_by: string | null
          reporting_jurisdiction: string
          reporting_window_hours: number | null
          tenant_id: string
          trigger_type: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          basis_at: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          incident_id: string
          notes?: string | null
          osha_case_number?: string | null
          report_method?: string | null
          reported_at?: string | null
          reported_by?: string | null
          reporting_jurisdiction?: string
          reporting_window_hours?: number | null
          tenant_id: string
          trigger_type: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          basis_at?: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          incident_id?: string
          notes?: string | null
          osha_case_number?: string | null
          report_method?: string | null
          reported_at?: string | null
          reported_by?: string | null
          reporting_jurisdiction?: string
          reporting_window_hours?: number | null
          tenant_id?: string
          trigger_type?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_severe_injury_reports_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_severe_injury_reports_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_severe_injury_reports_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_severe_injury_reports_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_severe_injury_reports_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_severe_injury_reports_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_witness_statements: {
        Row: {
          collected_at: string | null
          collected_by: string | null
          collected_via: string
          collection_token: string | null
          created_at: string
          id: string
          incident_id: string
          ip_address: unknown
          signed_at: string | null
          signed_name: string | null
          statement_text: string | null
          tenant_id: string
          token_consumed_at: string | null
          token_expires_at: string | null
          updated_at: string
          user_agent: string | null
          witness_person_id: string | null
        }
        Insert: {
          collected_at?: string | null
          collected_by?: string | null
          collected_via: string
          collection_token?: string | null
          created_at?: string
          id?: string
          incident_id: string
          ip_address?: unknown
          signed_at?: string | null
          signed_name?: string | null
          statement_text?: string | null
          tenant_id: string
          token_consumed_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_agent?: string | null
          witness_person_id?: string | null
        }
        Update: {
          collected_at?: string | null
          collected_by?: string | null
          collected_via?: string
          collection_token?: string | null
          created_at?: string
          id?: string
          incident_id?: string
          ip_address?: unknown
          signed_at?: string | null
          signed_name?: string | null
          statement_text?: string | null
          tenant_id?: string
          token_consumed_at?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_agent?: string | null
          witness_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_witness_statements_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_witness_statements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_witness_statements_witness_person_id_fkey"
            columns: ["witness_person_id"]
            isOneToOne: false
            referencedRelation: "incident_people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_witness_statements_witness_person_id_fkey"
            columns: ["witness_person_id"]
            isOneToOne: false
            referencedRelation: "incident_people_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          anon_public_status_note: string | null
          anon_receipt_hash: string | null
          anon_token_id: string | null
          assigned_investigator: string | null
          classification_matrix_cell: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          description: string
          facility_id: string | null
          geo_mismatch: boolean | null
          id: string
          immediate_action_taken: string | null
          incident_type: string
          is_anonymous: boolean
          legacy_near_miss_id: string | null
          legal_hold_id: string | null
          location_geo: unknown
          location_text: string | null
          occurred_at: string
          probability: string | null
          related_confined_space_permit_id: string | null
          related_hot_work_permit_id: string | null
          related_jha_id: string | null
          related_loto_permit_id: string | null
          report_number: string | null
          reported_at: string
          reported_by: string | null
          severity_actual: string
          severity_potential: string | null
          shift: string | null
          spill_quantity: number | null
          spill_quantity_unit: string | null
          spill_substance: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workers_comp_claim_number: string | null
        }
        Insert: {
          anon_public_status_note?: string | null
          anon_receipt_hash?: string | null
          anon_token_id?: string | null
          assigned_investigator?: string | null
          classification_matrix_cell?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description: string
          facility_id?: string | null
          geo_mismatch?: boolean | null
          id?: string
          immediate_action_taken?: string | null
          incident_type: string
          is_anonymous?: boolean
          legacy_near_miss_id?: string | null
          legal_hold_id?: string | null
          location_geo?: unknown
          location_text?: string | null
          occurred_at: string
          probability?: string | null
          related_confined_space_permit_id?: string | null
          related_hot_work_permit_id?: string | null
          related_jha_id?: string | null
          related_loto_permit_id?: string | null
          report_number?: string | null
          reported_at?: string
          reported_by?: string | null
          severity_actual?: string
          severity_potential?: string | null
          shift?: string | null
          spill_quantity?: number | null
          spill_quantity_unit?: string | null
          spill_substance?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workers_comp_claim_number?: string | null
        }
        Update: {
          anon_public_status_note?: string | null
          anon_receipt_hash?: string | null
          anon_token_id?: string | null
          assigned_investigator?: string | null
          classification_matrix_cell?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string
          facility_id?: string | null
          geo_mismatch?: boolean | null
          id?: string
          immediate_action_taken?: string | null
          incident_type?: string
          is_anonymous?: boolean
          legacy_near_miss_id?: string | null
          legal_hold_id?: string | null
          location_geo?: unknown
          location_text?: string | null
          occurred_at?: string
          probability?: string | null
          related_confined_space_permit_id?: string | null
          related_hot_work_permit_id?: string | null
          related_jha_id?: string | null
          related_loto_permit_id?: string | null
          report_number?: string | null
          reported_at?: string
          reported_by?: string | null
          severity_actual?: string
          severity_potential?: string | null
          shift?: string | null
          spill_quantity?: number | null
          spill_quantity_unit?: string | null
          spill_substance?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workers_comp_claim_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incidents_anon_token_id_fkey"
            columns: ["anon_token_id"]
            isOneToOne: false
            referencedRelation: "incident_anon_intake_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_legal_hold_id_fkey"
            columns: ["legal_hold_id"]
            isOneToOne: false
            referencedRelation: "legal_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incidents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_responses: {
        Row: {
          created_at: string
          evidence_id: string | null
          id: string
          inspection_id: string
          item_id: string
          note: string | null
          result: string | null
          tenant_id: string
          value: Json | null
        }
        Insert: {
          created_at?: string
          evidence_id?: string | null
          id?: string
          inspection_id: string
          item_id: string
          note?: string | null
          result?: string | null
          tenant_id: string
          value?: Json | null
        }
        Update: {
          created_at?: string
          evidence_id?: string | null
          id?: string
          inspection_id?: string
          item_id?: string
          note?: string | null
          result?: string | null
          tenant_id?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "inspection_responses_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_responses_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "inspection_template_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_responses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_template_items: {
        Row: {
          config: Json
          created_at: string
          fail_creates_action: boolean
          id: string
          item_type: string
          prompt: string
          required: boolean
          section: string
          sort_order: number
          template_id: string
          tenant_id: string
          weight: number
        }
        Insert: {
          config?: Json
          created_at?: string
          fail_creates_action?: boolean
          id?: string
          item_type: string
          prompt: string
          required?: boolean
          section?: string
          sort_order?: number
          template_id: string
          tenant_id: string
          weight?: number
        }
        Update: {
          config?: Json
          created_at?: string
          fail_creates_action?: boolean
          id?: string
          item_type?: string
          prompt?: string
          required?: boolean
          section?: string
          sort_order?: number
          template_id?: string
          tenant_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_template_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspection_templates: {
        Row: {
          active: boolean
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          facility_id: string | null
          id: string
          name: string
          scoring_mode: string
          tenant_id: string
          updated_at: string
          version: number
        }
        Insert: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          facility_id?: string | null
          id?: string
          name: string
          scoring_mode?: string
          tenant_id: string
          updated_at?: string
          version?: number
        }
        Update: {
          active?: boolean
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          scoring_mode?: string
          tenant_id?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "inspection_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_templates_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspection_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          assignee_user_id: string | null
          created_at: string
          created_by: string | null
          due_at: string | null
          facility_id: string | null
          id: string
          max_score: number | null
          result: string | null
          score: number | null
          started_at: string
          status: string
          subject_id: string | null
          subject_type: string | null
          submitted_at: string | null
          submitted_by: string | null
          template_id: string
          template_version: number
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_user_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          facility_id?: string | null
          id?: string
          max_score?: number | null
          result?: string | null
          score?: number | null
          started_at?: string
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          template_id: string
          template_version: number
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_user_id?: string | null
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          facility_id?: string | null
          id?: string
          max_score?: number | null
          result?: string | null
          score?: number | null
          started_at?: string
          status?: string
          subject_id?: string | null
          subject_type?: string | null
          submitted_at?: string | null
          submitted_by?: string | null
          template_id?: string
          template_version?: number
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspections_assignee_user_id_fkey"
            columns: ["assignee_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "inspection_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inspector_token_accesses: {
        Row: {
          accessed_at: string
          id: string
          ip: string | null
          route: string
          tenant_id: string
          token_id: string
          user_agent: string | null
        }
        Insert: {
          accessed_at?: string
          id?: string
          ip?: string | null
          route: string
          tenant_id: string
          token_id: string
          user_agent?: string | null
        }
        Update: {
          accessed_at?: string
          id?: string
          ip?: string | null
          route?: string
          tenant_id?: string
          token_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspector_token_accesses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspector_token_accesses_token_id_fkey"
            columns: ["token_id"]
            isOneToOne: false
            referencedRelation: "inspector_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      inspector_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          label: string
          revoked_at: string | null
          revoked_by: string | null
          snapshot_byte_size: number | null
          snapshot_error: string | null
          snapshot_manifest: Json | null
          snapshot_produced_at: string | null
          snapshot_purged_at: string | null
          snapshot_sha256: string | null
          snapshot_status: string
          snapshot_storage_path: string | null
          tenant_id: string
          time_zone: string
          token_hash: string
          updated_at: string
          window_end: string
          window_start: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          label: string
          revoked_at?: string | null
          revoked_by?: string | null
          snapshot_byte_size?: number | null
          snapshot_error?: string | null
          snapshot_manifest?: Json | null
          snapshot_produced_at?: string | null
          snapshot_purged_at?: string | null
          snapshot_sha256?: string | null
          snapshot_status?: string
          snapshot_storage_path?: string | null
          tenant_id: string
          time_zone: string
          token_hash: string
          updated_at?: string
          window_end: string
          window_start: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          label?: string
          revoked_at?: string | null
          revoked_by?: string | null
          snapshot_byte_size?: number | null
          snapshot_error?: string | null
          snapshot_manifest?: Json | null
          snapshot_produced_at?: string | null
          snapshot_purged_at?: string | null
          snapshot_sha256?: string | null
          snapshot_status?: string
          snapshot_storage_path?: string | null
          tenant_id?: string
          time_zone?: string
          token_hash?: string
          updated_at?: string
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspector_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invite_tokens: {
        Row: {
          created_at: string
          created_by: string | null
          email: string
          expires_at: string
          id: string
          superseded_at: string | null
          tenant_id: string | null
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          email: string
          expires_at: string
          id?: string
          superseded_at?: string | null
          tenant_id?: string | null
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          email?: string
          expires_at?: string
          id?: string
          superseded_at?: string | null
          tenant_id?: string | null
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invite_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      iso14001_clause_evidence: {
        Row: {
          captured_at: string
          captured_by_user_id: string | null
          clause_code: string
          created_at: string
          id: string
          notes: string | null
          source_id: string
          source_table: string
          tenant_id: string
        }
        Insert: {
          captured_at?: string
          captured_by_user_id?: string | null
          clause_code: string
          created_at?: string
          id?: string
          notes?: string | null
          source_id: string
          source_table: string
          tenant_id: string
        }
        Update: {
          captured_at?: string
          captured_by_user_id?: string | null
          clause_code?: string
          created_at?: string
          id?: string
          notes?: string | null
          source_id?: string
          source_table?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iso14001_clause_evidence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      iso45001_clause_evidence: {
        Row: {
          captured_at: string
          captured_by_user_id: string | null
          clause_code: string
          created_at: string
          id: string
          notes: string | null
          source_id: string
          source_table: string
          tenant_id: string
        }
        Insert: {
          captured_at?: string
          captured_by_user_id?: string | null
          clause_code: string
          created_at?: string
          id?: string
          notes?: string | null
          source_id: string
          source_table: string
          tenant_id: string
        }
        Update: {
          captured_at?: string
          captured_by_user_id?: string | null
          clause_code?: string
          created_at?: string
          id?: string
          notes?: string | null
          source_id?: string
          source_table?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "iso45001_clause_evidence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jha_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          after_row: Json | null
          before_row: Json | null
          context: string | null
          event_type: string
          id: number
          jha_id: string
          occurred_at: string
          tenant_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type: string
          id?: number
          jha_id: string
          occurred_at?: string
          tenant_id?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type?: string
          id?: number
          jha_id?: string
          occurred_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jha_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jha_hazard_controls: {
        Row: {
          control_id: string | null
          created_at: string
          custom_name: string | null
          hazard_id: string
          hierarchy_level: string
          id: string
          jha_id: string
          notes: string | null
          tenant_id: string
        }
        Insert: {
          control_id?: string | null
          created_at?: string
          custom_name?: string | null
          hazard_id: string
          hierarchy_level: string
          id?: string
          jha_id: string
          notes?: string | null
          tenant_id?: string
        }
        Update: {
          control_id?: string | null
          created_at?: string
          custom_name?: string | null
          hazard_id?: string
          hierarchy_level?: string
          id?: string
          jha_id?: string
          notes?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jha_hazard_controls_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "controls_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_hazard_controls_hazard_id_fkey"
            columns: ["hazard_id"]
            isOneToOne: false
            referencedRelation: "jha_hazards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_hazard_controls_jha_id_fkey"
            columns: ["jha_id"]
            isOneToOne: false
            referencedRelation: "jhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_hazard_controls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jha_hazards: {
        Row: {
          created_at: string
          description: string
          hazard_category: string
          id: string
          jha_id: string
          notes: string | null
          potential_severity: string
          step_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description: string
          hazard_category: string
          id?: string
          jha_id: string
          notes?: string | null
          potential_severity: string
          step_id?: string | null
          tenant_id?: string
        }
        Update: {
          created_at?: string
          description?: string
          hazard_category?: string
          id?: string
          jha_id?: string
          notes?: string | null
          potential_severity?: string
          step_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jha_hazards_jha_id_fkey"
            columns: ["jha_id"]
            isOneToOne: false
            referencedRelation: "jhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_hazards_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "jha_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_hazards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jha_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id?: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "jha_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jha_step_chemicals: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          step_id: string
          tenant_id: string
          usage_notes: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          step_id: string
          tenant_id: string
          usage_notes?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          step_id?: string
          tenant_id?: string
          usage_notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jha_step_chemicals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_step_chemicals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "jha_step_chemicals_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "jha_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_step_chemicals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jha_steps: {
        Row: {
          created_at: string
          description: string
          id: string
          jha_id: string
          notes: string | null
          sequence: number
          tenant_id: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          jha_id: string
          notes?: string | null
          sequence: number
          tenant_id?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          jha_id?: string
          notes?: string | null
          sequence?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jha_steps_jha_id_fkey"
            columns: ["jha_id"]
            isOneToOne: false
            referencedRelation: "jhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      jhas: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approver: string | null
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string | null
          facility_id: string | null
          frequency: string
          id: string
          job_number: string | null
          last_reviewed_at: string | null
          last_reviewed_by: string | null
          location: string | null
          next_review_date: string | null
          performed_by: string | null
          required_ppe: string[]
          reviewer: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approver?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          facility_id?: string | null
          frequency: string
          id?: string
          job_number?: string | null
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          location?: string | null
          next_review_date?: string | null
          performed_by?: string | null
          required_ppe?: string[]
          reviewer?: string | null
          status?: string
          tenant_id?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approver?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          facility_id?: string | null
          frequency?: string
          id?: string
          job_number?: string | null
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          location?: string | null
          next_review_date?: string | null
          performed_by?: string | null
          required_ppe?: string[]
          reviewer?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jhas_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jhas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_chunks: {
        Row: {
          chunk_index: number
          created_at: string
          document_id: string
          embedding: string
          id: string
          metadata: Json | null
          text: string
          token_count: number | null
        }
        Insert: {
          chunk_index: number
          created_at?: string
          document_id: string
          embedding: string
          id?: string
          metadata?: Json | null
          text: string
          token_count?: number | null
        }
        Update: {
          chunk_index?: number
          created_at?: string
          document_id?: string
          embedding?: string
          id?: string
          metadata?: Json | null
          text?: string
          token_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          chunk_count: number
          content_sha256: string
          created_at: string
          effective_date: string | null
          id: string
          jurisdiction: string | null
          source_type: Database["public"]["Enums"]["knowledge_source_type"]
          source_url: string | null
          tenant_id: string | null
          title: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          chunk_count?: number
          content_sha256: string
          created_at?: string
          effective_date?: string | null
          id?: string
          jurisdiction?: string | null
          source_type: Database["public"]["Enums"]["knowledge_source_type"]
          source_url?: string | null
          tenant_id?: string | null
          title: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          chunk_count?: number
          content_sha256?: string
          created_at?: string
          effective_date?: string | null
          id?: string
          jurisdiction?: string | null
          source_type?: Database["public"]["Enums"]["knowledge_source_type"]
          source_url?: string | null
          tenant_id?: string | null
          title?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_holds: {
        Row: {
          id: string
          placed_at: string
          placed_by_user_id: string
          reason: string
          released_at: string | null
          released_by_user_id: string | null
          scope: string
          scope_id: string | null
          tenant_id: string
        }
        Insert: {
          id?: string
          placed_at?: string
          placed_by_user_id: string
          reason: string
          released_at?: string | null
          released_by_user_id?: string | null
          scope: string
          scope_id?: string | null
          tenant_id: string
        }
        Update: {
          id?: string
          placed_at?: string
          placed_by_user_id?: string
          reason?: string
          released_at?: string | null
          released_by_user_id?: string | null
          scope?: string
          scope_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_holds_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_register: {
        Row: {
          ai_generated: boolean
          ai_model: string | null
          applicability_note: string | null
          authority: string | null
          citation: string
          created_at: string
          created_by: string | null
          effective_date: string | null
          id: string
          jurisdiction: string
          last_reviewed_at: string | null
          next_review_due: string | null
          review_frequency: string | null
          source_url: string | null
          status: string
          summary: string | null
          tags: string[]
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_generated?: boolean
          ai_model?: string | null
          applicability_note?: string | null
          authority?: string | null
          citation: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          jurisdiction: string
          last_reviewed_at?: string | null
          next_review_due?: string | null
          review_frequency?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_generated?: boolean
          ai_model?: string | null
          applicability_note?: string | null
          authority?: string | null
          citation?: string
          created_at?: string
          created_by?: string | null
          effective_date?: string | null
          id?: string
          jurisdiction?: string
          last_reviewed_at?: string | null
          next_review_due?: string | null
          review_frequency?: string | null
          source_url?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "legal_register_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_atmospheric_tests: {
        Row: {
          co_ppm: number | null
          created_at: string
          h2s_ppm: number | null
          id: string
          instrument_id: string | null
          kind: string
          lel_pct: number | null
          notes: string | null
          o2_pct: number | null
          other_readings: Json
          permit_id: string
          tenant_id: string
          tested_at: string
          tested_by: string
        }
        Insert: {
          co_ppm?: number | null
          created_at?: string
          h2s_ppm?: number | null
          id?: string
          instrument_id?: string | null
          kind?: string
          lel_pct?: number | null
          notes?: string | null
          o2_pct?: number | null
          other_readings?: Json
          permit_id: string
          tenant_id?: string
          tested_at?: string
          tested_by: string
        }
        Update: {
          co_ppm?: number | null
          created_at?: string
          h2s_ppm?: number | null
          id?: string
          instrument_id?: string | null
          kind?: string
          lel_pct?: number | null
          notes?: string | null
          o2_pct?: number | null
          other_readings?: Json
          permit_id?: string
          tenant_id?: string
          tested_at?: string
          tested_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_atmospheric_tests_permit_id_fkey"
            columns: ["permit_id"]
            isOneToOne: false
            referencedRelation: "loto_confined_space_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_atmospheric_tests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_atmospheric_tests_tested_by_fkey"
            columns: ["tested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_audit_changes: {
        Row: {
          agent: string
          applied_at: string | null
          apply_error: string | null
          change_kind: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decided_note: string | null
          equipment_id: string
          id: string
          new_value: Json | null
          old_value: Json | null
          rationale: string
          run_id: string
          severity: string | null
          staged_photo_url: string | null
          staged_storage_path: string | null
          status: string
          target_column: string | null
          target_row_pk: string | null
          target_table: string
          tenant_id: string
        }
        Insert: {
          agent: string
          applied_at?: string | null
          apply_error?: string | null
          change_kind: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_note?: string | null
          equipment_id: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          rationale: string
          run_id: string
          severity?: string | null
          staged_photo_url?: string | null
          staged_storage_path?: string | null
          status?: string
          target_column?: string | null
          target_row_pk?: string | null
          target_table: string
          tenant_id: string
        }
        Update: {
          agent?: string
          applied_at?: string | null
          apply_error?: string | null
          change_kind?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decided_note?: string | null
          equipment_id?: string
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          rationale?: string
          run_id?: string
          severity?: string | null
          staged_photo_url?: string | null
          staged_storage_path?: string | null
          status?: string
          target_column?: string | null
          target_row_pk?: string | null
          target_table?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_audit_changes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "loto_audit_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_audit_changes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_audit_equipment_results: {
        Row: {
          agent_phase: string
          created_at: string
          ds_consistency: Json | null
          ds_equipment_confidence: string | null
          ds_notes: string | null
          ehs_citations: Json | null
          ehs_notes: string | null
          ehs_pass: boolean | null
          ehs_recommendations: Json | null
          equip_photo_confidence: string | null
          equip_photo_verdict: string | null
          equipment_id: string
          fpe_notes: string | null
          id: string
          iso_photo_confidence: string | null
          iso_photo_verdict: string | null
          raw_payload: Json | null
          regulator_concurs: boolean | null
          regulator_payload: Json | null
          run_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          agent_phase?: string
          created_at?: string
          ds_consistency?: Json | null
          ds_equipment_confidence?: string | null
          ds_notes?: string | null
          ehs_citations?: Json | null
          ehs_notes?: string | null
          ehs_pass?: boolean | null
          ehs_recommendations?: Json | null
          equip_photo_confidence?: string | null
          equip_photo_verdict?: string | null
          equipment_id: string
          fpe_notes?: string | null
          id?: string
          iso_photo_confidence?: string | null
          iso_photo_verdict?: string | null
          raw_payload?: Json | null
          regulator_concurs?: boolean | null
          regulator_payload?: Json | null
          run_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          agent_phase?: string
          created_at?: string
          ds_consistency?: Json | null
          ds_equipment_confidence?: string | null
          ds_notes?: string | null
          ehs_citations?: Json | null
          ehs_notes?: string | null
          ehs_pass?: boolean | null
          ehs_recommendations?: Json | null
          equip_photo_confidence?: string | null
          equip_photo_verdict?: string | null
          equipment_id?: string
          fpe_notes?: string | null
          id?: string
          iso_photo_confidence?: string | null
          iso_photo_verdict?: string | null
          raw_payload?: Json | null
          regulator_concurs?: boolean | null
          regulator_payload?: Json | null
          run_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_audit_equipment_results_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "loto_audit_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_audit_equipment_results_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_audit_runs: {
        Row: {
          created_by: string | null
          error: string | null
          finished_at: string | null
          id: string
          models: Json | null
          processed_equipment: number
          regulator_report: Json | null
          review_link_id: string | null
          scope: Json
          started_at: string
          status: string
          tenant_id: string
          total_equipment: number
        }
        Insert: {
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          models?: Json | null
          processed_equipment?: number
          regulator_report?: Json | null
          review_link_id?: string | null
          scope?: Json
          started_at?: string
          status?: string
          tenant_id: string
          total_equipment?: number
        }
        Update: {
          created_by?: string | null
          error?: string | null
          finished_at?: string | null
          id?: string
          models?: Json | null
          processed_equipment?: number
          regulator_report?: Json | null
          review_link_id?: string | null
          scope?: Json
          started_at?: string
          status?: string
          tenant_id?: string
          total_equipment?: number
        }
        Relationships: [
          {
            foreignKeyName: "loto_audit_runs_review_link_id_fkey"
            columns: ["review_link_id"]
            isOneToOne: false
            referencedRelation: "loto_review_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_audit_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_audit_snapshot_equipment: {
        Row: {
          equipment_id: string
          id: string
          row: Json
          snapshot_id: string
          tenant_id: string
        }
        Insert: {
          equipment_id: string
          id?: string
          row: Json
          snapshot_id: string
          tenant_id: string
        }
        Update: {
          equipment_id?: string
          id?: string
          row?: Json
          snapshot_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_audit_snapshot_equipment_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "loto_audit_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_audit_snapshot_equipment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_audit_snapshot_steps: {
        Row: {
          equipment_id: string
          id: string
          row: Json
          snapshot_id: string
          step_id: string
          tenant_id: string
        }
        Insert: {
          equipment_id: string
          id?: string
          row: Json
          snapshot_id: string
          step_id: string
          tenant_id: string
        }
        Update: {
          equipment_id?: string
          id?: string
          row?: Json
          snapshot_id?: string
          step_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_audit_snapshot_steps_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "loto_audit_snapshots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_audit_snapshot_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_audit_snapshots: {
        Row: {
          captured_at: string
          captured_by: string | null
          equipment_count: number
          id: string
          reason: string
          run_id: string
          step_count: number
          tenant_id: string
        }
        Insert: {
          captured_at?: string
          captured_by?: string | null
          equipment_count?: number
          id?: string
          reason?: string
          run_id: string
          step_count?: number
          tenant_id: string
        }
        Update: {
          captured_at?: string
          captured_by?: string | null
          equipment_count?: number
          id?: string
          reason?: string
          run_id?: string
          step_count?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_audit_snapshots_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "loto_audit_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_audit_snapshots_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_cad_drawings: {
        Row: {
          drawn_date: string | null
          filename: string
          id: string
          is_current: boolean
          notes: string
          revision: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string
        }
        Insert: {
          drawn_date?: string | null
          filename: string
          id?: string
          is_current?: boolean
          notes?: string
          revision?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Update: {
          drawn_date?: string | null
          filename?: string
          id?: string
          is_current?: boolean
          notes?: string
          revision?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_cad_drawings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_competency_exam_attempts: {
        Row: {
          answers: Json
          completed_at: string | null
          created_at: string
          exam_id: string
          id: string
          passed: boolean | null
          proctor_user_id: string | null
          score: number | null
          started_at: string
          tenant_id: string
          training_record_id: string | null
          worker_id: string
        }
        Insert: {
          answers?: Json
          completed_at?: string | null
          created_at?: string
          exam_id: string
          id?: string
          passed?: boolean | null
          proctor_user_id?: string | null
          score?: number | null
          started_at?: string
          tenant_id: string
          training_record_id?: string | null
          worker_id: string
        }
        Update: {
          answers?: Json
          completed_at?: string | null
          created_at?: string
          exam_id?: string
          id?: string
          passed?: boolean | null
          proctor_user_id?: string | null
          score?: number | null
          started_at?: string
          tenant_id?: string
          training_record_id?: string | null
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_competency_exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "loto_competency_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_competency_exam_attempts_proctor_user_id_fkey"
            columns: ["proctor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_competency_exam_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_competency_exam_attempts_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "loto_training_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_competency_exam_attempts_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "loto_competency_exam_attempts_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_competency_exams: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          passing_score: number
          questions: Json
          role: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          passing_score?: number
          questions?: Json
          role: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          passing_score?: number
          questions?: Json
          role?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_competency_exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_competency_exams_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_competency_exams_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_confined_space_entries: {
        Row: {
          created_at: string
          entered_at: string
          entered_by: string
          entrant_name: string
          exited_at: string | null
          exited_by: string | null
          id: string
          notes: string | null
          permit_id: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          entered_at?: string
          entered_by: string
          entrant_name: string
          exited_at?: string | null
          exited_by?: string | null
          id?: string
          notes?: string | null
          permit_id: string
          tenant_id?: string
        }
        Update: {
          created_at?: string
          entered_at?: string
          entered_by?: string
          entrant_name?: string
          exited_at?: string | null
          exited_by?: string | null
          id?: string
          notes?: string | null
          permit_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_confined_space_entries_entered_by_fkey"
            columns: ["entered_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_space_entries_exited_by_fkey"
            columns: ["exited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_space_entries_permit_id_fkey"
            columns: ["permit_id"]
            isOneToOne: false
            referencedRelation: "loto_confined_space_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_space_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_confined_space_permits: {
        Row: {
          acceptable_conditions_override: Json | null
          attendant_signature_at: string | null
          attendant_signature_name: string | null
          attendants: string[]
          cancel_notes: string | null
          cancel_reason: string | null
          canceled_at: string | null
          communication_method: string | null
          concurrent_permits: string | null
          created_at: string
          entrant_acknowledgement_at: string | null
          entrants: string[]
          entry_supervisor_id: string
          entry_supervisor_signature_at: string | null
          equipment_list: string[]
          expires_at: string
          facility_id: string | null
          hazards_present: string[]
          id: string
          isolation_measures: string[]
          legal_hold_id: string | null
          notes: string | null
          purpose: string
          rescue_service: Json
          serial: string
          signon_token: string | null
          space_id: string
          started_at: string
          tenant_id: string
          updated_at: string
          work_order_ref: string | null
        }
        Insert: {
          acceptable_conditions_override?: Json | null
          attendant_signature_at?: string | null
          attendant_signature_name?: string | null
          attendants?: string[]
          cancel_notes?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          communication_method?: string | null
          concurrent_permits?: string | null
          created_at?: string
          entrant_acknowledgement_at?: string | null
          entrants?: string[]
          entry_supervisor_id: string
          entry_supervisor_signature_at?: string | null
          equipment_list?: string[]
          expires_at: string
          facility_id?: string | null
          hazards_present?: string[]
          id?: string
          isolation_measures?: string[]
          legal_hold_id?: string | null
          notes?: string | null
          purpose: string
          rescue_service?: Json
          serial: string
          signon_token?: string | null
          space_id: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          work_order_ref?: string | null
        }
        Update: {
          acceptable_conditions_override?: Json | null
          attendant_signature_at?: string | null
          attendant_signature_name?: string | null
          attendants?: string[]
          cancel_notes?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          communication_method?: string | null
          concurrent_permits?: string | null
          created_at?: string
          entrant_acknowledgement_at?: string | null
          entrants?: string[]
          entry_supervisor_id?: string
          entry_supervisor_signature_at?: string | null
          equipment_list?: string[]
          expires_at?: string
          facility_id?: string | null
          hazards_present?: string[]
          id?: string
          isolation_measures?: string[]
          legal_hold_id?: string | null
          notes?: string | null
          purpose?: string
          rescue_service?: Json
          serial?: string
          signon_token?: string | null
          space_id?: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          work_order_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_confined_space_permits_entry_supervisor_id_fkey"
            columns: ["entry_supervisor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_space_permits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_space_permits_legal_hold_id_fkey"
            columns: ["legal_hold_id"]
            isOneToOne: false
            referencedRelation: "legal_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_space_permits_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "loto_confined_spaces"
            referencedColumns: ["space_id"]
          },
          {
            foreignKeyName: "loto_confined_space_permits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_confined_spaces: {
        Row: {
          acceptable_conditions: Json | null
          classification: string
          created_at: string
          decommissioned: boolean
          department: string
          description: string
          entry_dimensions: string | null
          equip_photo_url: string | null
          facility_id: string | null
          interior_photo_url: string | null
          internal_notes: string | null
          isolation_required: string | null
          known_hazards: string[]
          space_id: string
          space_type: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          acceptable_conditions?: Json | null
          classification?: string
          created_at?: string
          decommissioned?: boolean
          department: string
          description: string
          entry_dimensions?: string | null
          equip_photo_url?: string | null
          facility_id?: string | null
          interior_photo_url?: string | null
          internal_notes?: string | null
          isolation_required?: string | null
          known_hazards?: string[]
          space_id: string
          space_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          acceptable_conditions?: Json | null
          classification?: string
          created_at?: string
          decommissioned?: boolean
          department?: string
          description?: string
          entry_dimensions?: string | null
          equip_photo_url?: string | null
          facility_id?: string | null
          interior_photo_url?: string | null
          internal_notes?: string | null
          isolation_required?: string | null
          known_hazards?: string[]
          space_id?: string
          space_type?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_confined_spaces_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_confined_spaces_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_contractor_companies: {
        Row: {
          active: boolean
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          facility_id: string | null
          host_acknowledged_by_user_id: string | null
          host_procedures_acknowledged_at: string | null
          id: string
          insurance_expires_at: string | null
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          facility_id?: string | null
          host_acknowledged_by_user_id?: string | null
          host_procedures_acknowledged_at?: string | null
          id?: string
          insurance_expires_at?: string | null
          name: string
          notes?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          facility_id?: string | null
          host_acknowledged_by_user_id?: string | null
          host_procedures_acknowledged_at?: string | null
          id?: string
          insurance_expires_at?: string | null
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_contractor_companies_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_contractor_companies_host_acknowledged_by_user_id_fkey"
            columns: ["host_acknowledged_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_contractor_companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_device_checkouts: {
        Row: {
          checked_out_at: string
          created_at: string
          device_id: string
          equipment_id: string | null
          id: string
          notes: string | null
          owner_id: string | null
          recorded_by: string
          returned_at: string | null
          returned_by: string | null
          tenant_id: string
          worker_id: string | null
        }
        Insert: {
          checked_out_at?: string
          created_at?: string
          device_id: string
          equipment_id?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          recorded_by: string
          returned_at?: string | null
          returned_by?: string | null
          tenant_id?: string
          worker_id?: string | null
        }
        Update: {
          checked_out_at?: string
          created_at?: string
          device_id?: string
          equipment_id?: string | null
          id?: string
          notes?: string | null
          owner_id?: string | null
          recorded_by?: string
          returned_at?: string | null
          returned_by?: string | null
          tenant_id?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_device_checkouts_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "loto_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_device_checkouts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_device_checkouts_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_device_checkouts_returned_by_fkey"
            columns: ["returned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_device_checkouts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_device_checkouts_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "loto_device_checkouts_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_devices: {
        Row: {
          created_at: string
          current_checkout_id: string | null
          decommissioned: boolean
          description: string | null
          device_label: string
          facility_id: string | null
          id: string
          kind: string
          notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_checkout_id?: string | null
          decommissioned?: boolean
          description?: string | null
          device_label: string
          facility_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_checkout_id?: string | null
          decommissioned?: boolean
          description?: string | null
          device_label?: string
          facility_id?: string | null
          id?: string
          kind?: string
          notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_devices_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_devices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_drawing_defects: {
        Row: {
          as_drawn: string
          cad_drawing_id: string | null
          cad_sheet_ref: string
          corrected_at: string | null
          defect_type: string
          id: string
          identified_at: string
          identified_by: string
          notes: string
          pdf_x: number | null
          pdf_y: number | null
          related_equipment_id: string | null
          should_be: string
          status: string
          tenant_id: string
        }
        Insert: {
          as_drawn?: string
          cad_drawing_id?: string | null
          cad_sheet_ref?: string
          corrected_at?: string | null
          defect_type: string
          id?: string
          identified_at?: string
          identified_by?: string
          notes?: string
          pdf_x?: number | null
          pdf_y?: number | null
          related_equipment_id?: string | null
          should_be?: string
          status?: string
          tenant_id?: string
        }
        Update: {
          as_drawn?: string
          cad_drawing_id?: string | null
          cad_sheet_ref?: string
          corrected_at?: string | null
          defect_type?: string
          id?: string
          identified_at?: string
          identified_by?: string
          notes?: string
          pdf_x?: number | null
          pdf_y?: number | null
          related_equipment_id?: string | null
          should_be?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_drawing_defects_cad_drawing_id_fkey"
            columns: ["cad_drawing_id"]
            isOneToOne: false
            referencedRelation: "loto_cad_drawings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_drawing_defects_related_equipment_id_fkey"
            columns: ["related_equipment_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_drawing_defects_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_energy_steps: {
        Row: {
          confidence: string | null
          confidence_source: string | null
          created_at: string | null
          energy_type: string
          equipment_id: string
          id: string
          isolation_procedure: string | null
          isolation_procedure_es: string | null
          method_of_verification: string | null
          method_of_verification_es: string | null
          sequence_order: number
          step_number: number
          step_type: string
          tag_description: string | null
          tag_description_es: string | null
          tenant_id: string
          tryout_required: boolean
        }
        Insert: {
          confidence?: string | null
          confidence_source?: string | null
          created_at?: string | null
          energy_type: string
          equipment_id: string
          id?: string
          isolation_procedure?: string | null
          isolation_procedure_es?: string | null
          method_of_verification?: string | null
          method_of_verification_es?: string | null
          sequence_order: number
          step_number?: number
          step_type: string
          tag_description?: string | null
          tag_description_es?: string | null
          tenant_id?: string
          tryout_required?: boolean
        }
        Update: {
          confidence?: string | null
          confidence_source?: string | null
          created_at?: string | null
          energy_type?: string
          equipment_id?: string
          id?: string
          isolation_procedure?: string | null
          isolation_procedure_es?: string | null
          method_of_verification?: string | null
          method_of_verification_es?: string | null
          sequence_order?: number
          step_number?: number
          step_type?: string
          tag_description?: string | null
          tag_description_es?: string | null
          tenant_id?: string
          tryout_required?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "loto_energy_steps_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_equipment: {
        Row: {
          annotations: Json
          cad_drawing_tag: string | null
          cad_grid_ref: string | null
          cad_sheet_ref: string | null
          consolidation_group: string | null
          created_at: string | null
          decommissioned: boolean
          department: string | null
          description: string | null
          e1_isolation: string | null
          e1_tag: string | null
          e1_type: string | null
          e1_verification: string | null
          e2_isolation: string | null
          e2_tag: string | null
          e2_type: string | null
          e2_verification: string | null
          e3_isolation: string | null
          e3_tag: string | null
          e3_type: string | null
          e3_verification: string | null
          equip_photo_provenance: string
          equip_photo_url: string | null
          equipment_family: string
          equipment_id: string
          facility_floor: string | null
          facility_id: string | null
          facility_x: number | null
          facility_y: number | null
          flagged_for_review_at: string | null
          flagged_for_review_by: string | null
          flagged_for_review_note: string | null
          flagged_for_review_via: string | null
          has_equip_photo: boolean | null
          has_iso_photo: boolean | null
          id: string
          internal_notes: string | null
          iso_annotations: Json
          iso_photo_is_placeholder: boolean
          iso_photo_placeholder_source_url: string | null
          iso_photo_provenance: string
          iso_photo_url: string | null
          last_audit_at: string | null
          last_audit_run_id: string | null
          last_audit_verdict: string | null
          last_pre_use_inspection_at: string | null
          last_pre_use_inspection_id: string | null
          legal_hold_id: string | null
          manufacturer: string | null
          model: string | null
          needs_equip_photo: boolean | null
          needs_iso_photo: boolean | null
          needs_verification: boolean | null
          next_periodic_review_due_at: string | null
          notes: string | null
          notes_es: string | null
          parent_equipment_id: string | null
          photo_status: string | null
          placard_qr_backfilled: boolean
          placard_url: string | null
          prefix: string | null
          qr_token: string
          readiness_status: string
          spanish_reviewed: boolean
          tenant_id: string
          updated_at: string | null
          verified: boolean | null
          verified_by: string | null
          verified_date: string | null
        }
        Insert: {
          annotations?: Json
          cad_drawing_tag?: string | null
          cad_grid_ref?: string | null
          cad_sheet_ref?: string | null
          consolidation_group?: string | null
          created_at?: string | null
          decommissioned?: boolean
          department?: string | null
          description?: string | null
          e1_isolation?: string | null
          e1_tag?: string | null
          e1_type?: string | null
          e1_verification?: string | null
          e2_isolation?: string | null
          e2_tag?: string | null
          e2_type?: string | null
          e2_verification?: string | null
          e3_isolation?: string | null
          e3_tag?: string | null
          e3_type?: string | null
          e3_verification?: string | null
          equip_photo_provenance?: string
          equip_photo_url?: string | null
          equipment_family?: string
          equipment_id: string
          facility_floor?: string | null
          facility_id?: string | null
          facility_x?: number | null
          facility_y?: number | null
          flagged_for_review_at?: string | null
          flagged_for_review_by?: string | null
          flagged_for_review_note?: string | null
          flagged_for_review_via?: string | null
          has_equip_photo?: boolean | null
          has_iso_photo?: boolean | null
          id?: string
          internal_notes?: string | null
          iso_annotations?: Json
          iso_photo_is_placeholder?: boolean
          iso_photo_placeholder_source_url?: string | null
          iso_photo_provenance?: string
          iso_photo_url?: string | null
          last_audit_at?: string | null
          last_audit_run_id?: string | null
          last_audit_verdict?: string | null
          last_pre_use_inspection_at?: string | null
          last_pre_use_inspection_id?: string | null
          legal_hold_id?: string | null
          manufacturer?: string | null
          model?: string | null
          needs_equip_photo?: boolean | null
          needs_iso_photo?: boolean | null
          needs_verification?: boolean | null
          next_periodic_review_due_at?: string | null
          notes?: string | null
          notes_es?: string | null
          parent_equipment_id?: string | null
          photo_status?: string | null
          placard_qr_backfilled?: boolean
          placard_url?: string | null
          prefix?: string | null
          qr_token: string
          readiness_status?: string
          spanish_reviewed?: boolean
          tenant_id?: string
          updated_at?: string | null
          verified?: boolean | null
          verified_by?: string | null
          verified_date?: string | null
        }
        Update: {
          annotations?: Json
          cad_drawing_tag?: string | null
          cad_grid_ref?: string | null
          cad_sheet_ref?: string | null
          consolidation_group?: string | null
          created_at?: string | null
          decommissioned?: boolean
          department?: string | null
          description?: string | null
          e1_isolation?: string | null
          e1_tag?: string | null
          e1_type?: string | null
          e1_verification?: string | null
          e2_isolation?: string | null
          e2_tag?: string | null
          e2_type?: string | null
          e2_verification?: string | null
          e3_isolation?: string | null
          e3_tag?: string | null
          e3_type?: string | null
          e3_verification?: string | null
          equip_photo_provenance?: string
          equip_photo_url?: string | null
          equipment_family?: string
          equipment_id?: string
          facility_floor?: string | null
          facility_id?: string | null
          facility_x?: number | null
          facility_y?: number | null
          flagged_for_review_at?: string | null
          flagged_for_review_by?: string | null
          flagged_for_review_note?: string | null
          flagged_for_review_via?: string | null
          has_equip_photo?: boolean | null
          has_iso_photo?: boolean | null
          id?: string
          internal_notes?: string | null
          iso_annotations?: Json
          iso_photo_is_placeholder?: boolean
          iso_photo_placeholder_source_url?: string | null
          iso_photo_provenance?: string
          iso_photo_url?: string | null
          last_audit_at?: string | null
          last_audit_run_id?: string | null
          last_audit_verdict?: string | null
          last_pre_use_inspection_at?: string | null
          last_pre_use_inspection_id?: string | null
          legal_hold_id?: string | null
          manufacturer?: string | null
          model?: string | null
          needs_equip_photo?: boolean | null
          needs_iso_photo?: boolean | null
          needs_verification?: boolean | null
          next_periodic_review_due_at?: string | null
          notes?: string | null
          notes_es?: string | null
          parent_equipment_id?: string | null
          photo_status?: string | null
          placard_qr_backfilled?: boolean
          placard_url?: string | null
          prefix?: string | null
          qr_token?: string
          readiness_status?: string
          spanish_reviewed?: boolean
          tenant_id?: string
          updated_at?: string | null
          verified?: boolean | null
          verified_by?: string | null
          verified_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_equipment_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_equipment_legal_hold_id_fkey"
            columns: ["legal_hold_id"]
            isOneToOne: false
            referencedRelation: "legal_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_equipment_parent_equipment_id_fkey"
            columns: ["parent_equipment_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_equipment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_gas_meters: {
        Row: {
          created_at: string
          decommissioned: boolean
          description: string | null
          facility_id: string | null
          instrument_id: string
          last_bump_at: string | null
          last_calibration_at: string | null
          next_calibration_due: string | null
          notes: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          decommissioned?: boolean
          description?: string | null
          facility_id?: string | null
          instrument_id: string
          last_bump_at?: string | null
          last_calibration_at?: string | null
          next_calibration_due?: string | null
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          decommissioned?: boolean
          description?: string | null
          facility_id?: string | null
          instrument_id?: string
          last_bump_at?: string | null
          last_calibration_at?: string | null
          next_calibration_due?: string | null
          notes?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_gas_meters_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_gas_meters_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_group_permit_handoffs: {
        Row: {
          from_user_id: string
          group_permit_id: string
          id: string
          notes: string | null
          occurred_at: string
          to_user_id: string
        }
        Insert: {
          from_user_id: string
          group_permit_id: string
          id?: string
          notes?: string | null
          occurred_at?: string
          to_user_id: string
        }
        Update: {
          from_user_id?: string
          group_permit_id?: string
          id?: string
          notes?: string | null
          occurred_at?: string
          to_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_group_permit_handoffs_from_user_id_fkey"
            columns: ["from_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_group_permit_handoffs_group_permit_id_fkey"
            columns: ["group_permit_id"]
            isOneToOne: false
            referencedRelation: "loto_group_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_group_permit_handoffs_to_user_id_fkey"
            columns: ["to_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_group_permit_members: {
        Row: {
          group_permit_id: string
          id: string
          joined_at: string
          left_at: string | null
          notes: string | null
          personal_lock_serial: string
          user_id: string | null
          worker_id: string | null
        }
        Insert: {
          group_permit_id: string
          id?: string
          joined_at?: string
          left_at?: string | null
          notes?: string | null
          personal_lock_serial: string
          user_id?: string | null
          worker_id?: string | null
        }
        Update: {
          group_permit_id?: string
          id?: string
          joined_at?: string
          left_at?: string | null
          notes?: string | null
          personal_lock_serial?: string
          user_id?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_group_permit_members_group_permit_id_fkey"
            columns: ["group_permit_id"]
            isOneToOne: false
            referencedRelation: "loto_group_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_group_permit_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_group_permit_members_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "loto_group_permit_members_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_group_permits: {
        Row: {
          close_notes: string | null
          created_at: string
          ended_at: string | null
          equipment_ids: string[]
          facility_id: string | null
          id: string
          primary_authorized_employee_id: string | null
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
          work_description: string
        }
        Insert: {
          close_notes?: string | null
          created_at?: string
          ended_at?: string | null
          equipment_ids?: string[]
          facility_id?: string | null
          id?: string
          primary_authorized_employee_id?: string | null
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
          work_description: string
        }
        Update: {
          close_notes?: string | null
          created_at?: string
          ended_at?: string | null
          equipment_ids?: string[]
          facility_id?: string | null
          id?: string
          primary_authorized_employee_id?: string | null
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          work_description?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_group_permits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_group_permits_primary_authorized_employee_id_fkey"
            columns: ["primary_authorized_employee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_group_permits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_hot_work_permit_photos: {
        Row: {
          caption: string | null
          created_at: string
          created_by: string | null
          id: string
          permit_id: string
          phase: string
          photo_url: string
          tenant_id: string
        }
        Insert: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          permit_id: string
          phase?: string
          photo_url: string
          tenant_id: string
        }
        Update: {
          caption?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          permit_id?: string
          phase?: string
          photo_url?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_hot_work_permit_photos_permit_id_fkey"
            columns: ["permit_id"]
            isOneToOne: false
            referencedRelation: "loto_hot_work_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_hot_work_permit_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_hot_work_permits: {
        Row: {
          associated_cs_permit_id: string | null
          cancel_notes: string | null
          cancel_reason: string | null
          canceled_at: string | null
          created_at: string
          equipment_id: string | null
          expires_at: string
          facility_id: string | null
          fire_watch_personnel: string[]
          fire_watch_signature_at: string | null
          fire_watch_signature_name: string | null
          hot_work_operators: string[]
          id: string
          legal_hold_id: string | null
          notes: string | null
          pai_id: string
          pai_signature_at: string | null
          post_watch_minutes: number
          pre_work_checks: Json
          serial: string
          started_at: string
          tenant_id: string
          updated_at: string
          work_completed_at: string | null
          work_description: string
          work_location: string
          work_order_ref: string | null
          work_types: string[]
        }
        Insert: {
          associated_cs_permit_id?: string | null
          cancel_notes?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          created_at?: string
          equipment_id?: string | null
          expires_at: string
          facility_id?: string | null
          fire_watch_personnel?: string[]
          fire_watch_signature_at?: string | null
          fire_watch_signature_name?: string | null
          hot_work_operators?: string[]
          id?: string
          legal_hold_id?: string | null
          notes?: string | null
          pai_id: string
          pai_signature_at?: string | null
          post_watch_minutes?: number
          pre_work_checks?: Json
          serial: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          work_completed_at?: string | null
          work_description: string
          work_location: string
          work_order_ref?: string | null
          work_types?: string[]
        }
        Update: {
          associated_cs_permit_id?: string | null
          cancel_notes?: string | null
          cancel_reason?: string | null
          canceled_at?: string | null
          created_at?: string
          equipment_id?: string | null
          expires_at?: string
          facility_id?: string | null
          fire_watch_personnel?: string[]
          fire_watch_signature_at?: string | null
          fire_watch_signature_name?: string | null
          hot_work_operators?: string[]
          id?: string
          legal_hold_id?: string | null
          notes?: string | null
          pai_id?: string
          pai_signature_at?: string | null
          post_watch_minutes?: number
          pre_work_checks?: Json
          serial?: string
          started_at?: string
          tenant_id?: string
          updated_at?: string
          work_completed_at?: string | null
          work_description?: string
          work_location?: string
          work_order_ref?: string | null
          work_types?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "loto_hot_work_permits_associated_cs_permit_id_fkey"
            columns: ["associated_cs_permit_id"]
            isOneToOne: false
            referencedRelation: "loto_confined_space_permits"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_hot_work_permits_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "loto_hot_work_permits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_hot_work_permits_legal_hold_id_fkey"
            columns: ["legal_hold_id"]
            isOneToOne: false
            referencedRelation: "legal_holds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_hot_work_permits_pai_id_fkey"
            columns: ["pai_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_hot_work_permits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_hygiene_log: {
        Row: {
          action: string
          detail: Json | null
          equipment_id: string | null
          facility_id: string | null
          id: string
          ran_at: string
          reason: string
          section: string
          tenant_id: string
        }
        Insert: {
          action: string
          detail?: Json | null
          equipment_id?: string | null
          facility_id?: string | null
          id?: string
          ran_at?: string
          reason: string
          section: string
          tenant_id?: string
        }
        Update: {
          action?: string
          detail?: Json | null
          equipment_id?: string | null
          facility_id?: string | null
          id?: string
          ran_at?: string
          reason?: string
          section?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_hygiene_log_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_hygiene_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_meter_alerts: {
        Row: {
          alert_kind: string
          facility_id: string | null
          id: string
          instrument_id: string
          recipients: number
          sent_at: string
          tenant_id: string
        }
        Insert: {
          alert_kind: string
          facility_id?: string | null
          id?: string
          instrument_id: string
          recipients?: number
          sent_at?: string
          tenant_id?: string
        }
        Update: {
          alert_kind?: string
          facility_id?: string | null
          id?: string
          instrument_id?: string
          recipients?: number
          sent_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_meter_alerts_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_meter_alerts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_org_config: {
        Row: {
          id: number
          push_dispatch_secret: string | null
          push_dispatch_url: string | null
          updated_at: string
          updated_by: string | null
          work_order_url_template: string | null
        }
        Insert: {
          id: number
          push_dispatch_secret?: string | null
          push_dispatch_url?: string | null
          updated_at?: string
          updated_by?: string | null
          work_order_url_template?: string | null
        }
        Update: {
          id?: number
          push_dispatch_secret?: string | null
          push_dispatch_url?: string | null
          updated_at?: string
          updated_by?: string | null
          work_order_url_template?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_org_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_periodic_inspections: {
        Row: {
          authorized_employees_observed: Json
          corrective_actions: string | null
          created_at: string
          deviations: string | null
          equipment_id: string
          facility_id: string | null
          id: string
          inspected_at: string
          inspector_name: string
          inspector_user_id: string | null
          ip: string | null
          next_due_at: string
          signature: string | null
          signed: boolean
          signed_at: string | null
          signed_name: string | null
          tenant_id: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          authorized_employees_observed?: Json
          corrective_actions?: string | null
          created_at?: string
          deviations?: string | null
          equipment_id: string
          facility_id?: string | null
          id?: string
          inspected_at?: string
          inspector_name: string
          inspector_user_id?: string | null
          ip?: string | null
          next_due_at?: string
          signature?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          tenant_id: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          authorized_employees_observed?: Json
          corrective_actions?: string | null
          created_at?: string
          deviations?: string | null
          equipment_id?: string
          facility_id?: string | null
          id?: string
          inspected_at?: string
          inspector_name?: string
          inspector_user_id?: string | null
          ip?: string | null
          next_due_at?: string
          signature?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          tenant_id?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_periodic_inspections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_periodic_inspections_inspector_user_id_fkey"
            columns: ["inspector_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_periodic_inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_placard_reviews: {
        Row: {
          created_at: string
          equipment_id: string
          id: string
          notes: string | null
          review_link_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment_id: string
          id?: string
          notes?: string | null
          review_link_id: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment_id?: string
          id?: string
          notes?: string | null
          review_link_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_placard_reviews_review_link_id_fkey"
            columns: ["review_link_id"]
            isOneToOne: false
            referencedRelation: "loto_review_links"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_placard_scan_log: {
        Row: {
          equipment_id: string
          id: number
          ip: string | null
          qr_token: string
          scanned_at: string
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          equipment_id: string
          id?: never
          ip?: string | null
          qr_token: string
          scanned_at?: string
          tenant_id: string
          user_agent?: string | null
        }
        Update: {
          equipment_id?: string
          id?: never
          ip?: string | null
          qr_token?: string
          scanned_at?: string
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_placard_scan_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          last_used_at: string | null
          p256dh: string
          profile_id: string
          tenant_id: string
          user_agent: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          last_used_at?: string | null
          p256dh: string
          profile_id: string
          tenant_id?: string
          user_agent?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          last_used_at?: string | null
          p256dh?: string
          profile_id?: string
          tenant_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_push_subscriptions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_push_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_retraining_triggers: {
        Row: {
          created_at: string
          equipment_id: string | null
          facility_id: string | null
          id: string
          reason: string | null
          resolved_at: string | null
          tenant_id: string
          training_record_id: string | null
          trigger_type: string
          triggered_at: string
          worker_id: string
        }
        Insert: {
          created_at?: string
          equipment_id?: string | null
          facility_id?: string | null
          id?: string
          reason?: string | null
          resolved_at?: string | null
          tenant_id: string
          training_record_id?: string | null
          trigger_type: string
          triggered_at?: string
          worker_id: string
        }
        Update: {
          created_at?: string
          equipment_id?: string | null
          facility_id?: string | null
          id?: string
          reason?: string | null
          resolved_at?: string | null
          tenant_id?: string
          training_record_id?: string | null
          trigger_type?: string
          triggered_at?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_retraining_triggers_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_retraining_triggers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_retraining_triggers_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "loto_training_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_retraining_triggers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "loto_retraining_triggers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_review_link_equipment: {
        Row: {
          created_at: string
          department: string
          equipment_description: string | null
          equipment_id: string
          field_note: string | null
          field_photo_storage_path: string | null
          flagged_at: string | null
          flagged_by_user_id: string | null
          id: string
          reason_code: string | null
          review_link_id: string
          sort_order: number
          source: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          department: string
          equipment_description?: string | null
          equipment_id: string
          field_note?: string | null
          field_photo_storage_path?: string | null
          flagged_at?: string | null
          flagged_by_user_id?: string | null
          id?: string
          reason_code?: string | null
          review_link_id: string
          sort_order?: number
          source?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          department?: string
          equipment_description?: string | null
          equipment_id?: string
          field_note?: string | null
          field_photo_storage_path?: string | null
          flagged_at?: string | null
          flagged_by_user_id?: string | null
          id?: string
          reason_code?: string | null
          review_link_id?: string
          sort_order?: number
          source?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_review_link_equipment_review_link_id_fkey"
            columns: ["review_link_id"]
            isOneToOne: false
            referencedRelation: "loto_review_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_review_link_equipment_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_review_links: {
        Row: {
          admin_message: string | null
          audit_run_id: string | null
          created_at: string
          created_by: string | null
          department: string | null
          email_channel: string
          email_provider_id: string | null
          expires_at: string
          extension_count: number
          first_viewed_at: string | null
          id: string
          is_public: boolean
          kind: string
          last_extended_at: string | null
          last_extended_by: string | null
          reviewer_email: string | null
          reviewer_name: string | null
          revoked_at: string | null
          revoked_by: string | null
          sent_at: string | null
          signed_off_at: string | null
          signoff_approved: boolean | null
          signoff_ip: string | null
          signoff_notes: string | null
          signoff_signature: string | null
          signoff_typed_name: string | null
          signoff_user_agent: string | null
          tenant_id: string
          token: string | null
        }
        Insert: {
          admin_message?: string | null
          audit_run_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          email_channel?: string
          email_provider_id?: string | null
          expires_at?: string
          extension_count?: number
          first_viewed_at?: string | null
          id?: string
          is_public?: boolean
          kind?: string
          last_extended_at?: string | null
          last_extended_by?: string | null
          reviewer_email?: string | null
          reviewer_name?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          sent_at?: string | null
          signed_off_at?: string | null
          signoff_approved?: boolean | null
          signoff_ip?: string | null
          signoff_notes?: string | null
          signoff_signature?: string | null
          signoff_typed_name?: string | null
          signoff_user_agent?: string | null
          tenant_id?: string
          token?: string | null
        }
        Update: {
          admin_message?: string | null
          audit_run_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          email_channel?: string
          email_provider_id?: string | null
          expires_at?: string
          extension_count?: number
          first_viewed_at?: string | null
          id?: string
          is_public?: boolean
          kind?: string
          last_extended_at?: string | null
          last_extended_by?: string | null
          reviewer_email?: string | null
          reviewer_name?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          sent_at?: string | null
          signed_off_at?: string | null
          signoff_approved?: boolean | null
          signoff_ip?: string | null
          signoff_notes?: string | null
          signoff_signature?: string | null
          signoff_typed_name?: string | null
          signoff_user_agent?: string | null
          tenant_id?: string
          token?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_review_links_audit_run_id_fkey"
            columns: ["audit_run_id"]
            isOneToOne: false
            referencedRelation: "loto_audit_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_review_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_review_photo_replacements: {
        Row: {
          applied_at: string | null
          applied_by: string | null
          equipment_id: string
          id: string
          new_photo_url: string
          old_photo_url: string | null
          old_placard_url: string | null
          old_signed_placard_url: string | null
          rejected_reason: string | null
          replaced_at: string
          replaced_by_name: string | null
          replaced_ip: string | null
          replaced_user_agent: string | null
          review_link_id: string
          slot: string
          status: string
          storage_path: string
          tenant_id: string
        }
        Insert: {
          applied_at?: string | null
          applied_by?: string | null
          equipment_id: string
          id?: string
          new_photo_url: string
          old_photo_url?: string | null
          old_placard_url?: string | null
          old_signed_placard_url?: string | null
          rejected_reason?: string | null
          replaced_at?: string
          replaced_by_name?: string | null
          replaced_ip?: string | null
          replaced_user_agent?: string | null
          review_link_id: string
          slot: string
          status?: string
          storage_path: string
          tenant_id: string
        }
        Update: {
          applied_at?: string | null
          applied_by?: string | null
          equipment_id?: string
          id?: string
          new_photo_url?: string
          old_photo_url?: string | null
          old_placard_url?: string | null
          old_signed_placard_url?: string | null
          rejected_reason?: string | null
          replaced_at?: string
          replaced_by_name?: string | null
          replaced_ip?: string | null
          replaced_user_agent?: string | null
          review_link_id?: string
          slot?: string
          status?: string
          storage_path?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_review_photo_replacements_review_link_id_fkey"
            columns: ["review_link_id"]
            isOneToOne: false
            referencedRelation: "loto_review_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_review_photo_replacements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_reviews: {
        Row: {
          approved: boolean
          created_at: string
          department: string
          facility_id: string | null
          id: string
          notes: string | null
          reviewer_email: string | null
          reviewer_name: string | null
          signed_at: string | null
          tenant_id: string
        }
        Insert: {
          approved?: boolean
          created_at?: string
          department: string
          facility_id?: string | null
          id?: string
          notes?: string | null
          reviewer_email?: string | null
          reviewer_name?: string | null
          signed_at?: string | null
          tenant_id?: string
        }
        Update: {
          approved?: boolean
          created_at?: string
          department?: string
          facility_id?: string | null
          id?: string
          notes?: string | null
          reviewer_email?: string | null
          reviewer_name?: string | null
          signed_at?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_reviews_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_signed_pdf_artifacts: {
        Row: {
          created_at: string
          equipment_id: string
          id: string
          pdf_storage_path: string
          review_link_id: string | null
          sha256_hex: string
          signed_at: string
          signer_drawn_signature_path: string | null
          signer_ip: string | null
          signer_typed_name: string
          signer_user_agent: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          equipment_id: string
          id?: string
          pdf_storage_path: string
          review_link_id?: string | null
          sha256_hex: string
          signed_at: string
          signer_drawn_signature_path?: string | null
          signer_ip?: string | null
          signer_typed_name: string
          signer_user_agent?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          equipment_id?: string
          id?: string
          pdf_storage_path?: string
          review_link_id?: string | null
          sha256_hex?: string
          signed_at?: string
          signer_drawn_signature_path?: string | null
          signer_ip?: string | null
          signer_typed_name?: string
          signer_user_agent?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_signed_pdf_artifacts_review_link_id_fkey"
            columns: ["review_link_id"]
            isOneToOne: false
            referencedRelation: "loto_review_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_signed_pdf_artifacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_training_records: {
        Row: {
          cert_authority: string | null
          completed_at: string
          course_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          facility_id: string | null
          id: string
          member_id: string | null
          metadata: Json
          notes: string | null
          role: string
          tenant_id: string
          updated_at: string
          worker_name: string
        }
        Insert: {
          cert_authority?: string | null
          completed_at: string
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          facility_id?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json
          notes?: string | null
          role: string
          tenant_id?: string
          updated_at?: string
          worker_name: string
        }
        Update: {
          cert_authority?: string | null
          completed_at?: string
          course_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          facility_id?: string | null
          id?: string
          member_id?: string | null
          metadata?: Json
          notes?: string | null
          role?: string
          tenant_id?: string
          updated_at?: string
          worker_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_training_records_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "training_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_training_records_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_training_records_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_training_records_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_training_records_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_training_records_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "loto_training_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_walkdown_checklists: {
        Row: {
          completed_by_name: string
          completed_by_user_id: string | null
          created_at: string
          equipment_id: string
          facility_id: string | null
          id: string
          items: Json
          notes: string | null
          signature: string | null
          signed: boolean
          signed_at: string | null
          signed_name: string | null
          tenant_id: string
          updated_at: string
          walkdown_date: string
        }
        Insert: {
          completed_by_name: string
          completed_by_user_id?: string | null
          created_at?: string
          equipment_id: string
          facility_id?: string | null
          id?: string
          items?: Json
          notes?: string | null
          signature?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          tenant_id: string
          updated_at?: string
          walkdown_date?: string
        }
        Update: {
          completed_by_name?: string
          completed_by_user_id?: string | null
          created_at?: string
          equipment_id?: string
          facility_id?: string | null
          id?: string
          items?: Json
          notes?: string | null
          signature?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          tenant_id?: string
          updated_at?: string
          walkdown_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_walkdown_checklists_completed_by_user_id_fkey"
            columns: ["completed_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_walkdown_checklists_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_walkdown_checklists_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_webhook_deliveries: {
        Row: {
          completed_at: string | null
          duration_ms: number | null
          error: string | null
          event: string
          fired_at: string
          id: number
          payload: Json
          request_id: number | null
          response_body: string | null
          response_headers: Json | null
          response_status: number | null
          subscription_id: string | null
          subscription_name: string | null
          subscription_url: string
          tenant_id: string | null
        }
        Insert: {
          completed_at?: string | null
          duration_ms?: number | null
          error?: string | null
          event: string
          fired_at?: string
          id?: number
          payload: Json
          request_id?: number | null
          response_body?: string | null
          response_headers?: Json | null
          response_status?: number | null
          subscription_id?: string | null
          subscription_name?: string | null
          subscription_url: string
          tenant_id?: string | null
        }
        Update: {
          completed_at?: string | null
          duration_ms?: number | null
          error?: string | null
          event?: string
          fired_at?: string
          id?: number
          payload?: Json
          request_id?: number | null
          response_body?: string | null
          response_headers?: Json | null
          response_status?: number | null
          subscription_id?: string | null
          subscription_name?: string | null
          subscription_url?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_webhook_deliveries_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "loto_webhook_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_webhook_deliveries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_webhook_subscriptions: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          events: string[]
          facility_id: string | null
          id: string
          last_ssrf_skip_at: string | null
          name: string
          secret: string | null
          tenant_id: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          events?: string[]
          facility_id?: string | null
          id?: string
          last_ssrf_skip_at?: string | null
          name: string
          secret?: string | null
          tenant_id?: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          events?: string[]
          facility_id?: string | null
          id?: string
          last_ssrf_skip_at?: string | null
          name?: string
          secret?: string | null
          tenant_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_webhook_subscriptions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_webhook_subscriptions_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_webhook_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_workers: {
        Row: {
          active: boolean
          contractor_company_id: string | null
          created_at: string
          created_by: string | null
          email: string | null
          employee_id: string | null
          full_name: string
          id: string
          notes: string | null
          scim_external_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          contractor_company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          employee_id?: string | null
          full_name: string
          id?: string
          notes?: string | null
          scim_external_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          contractor_company_id?: string | null
          created_at?: string
          created_by?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          scim_external_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_workers_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "loto_contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_workers_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_workers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_zero_energy_certifications: {
        Row: {
          certified_at: string
          certified_by: string
          created_at: string
          equipment_id: string
          id: string
          method: string | null
          notes: string | null
          revoked_at: string | null
          revoked_by: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          certified_at?: string
          certified_by: string
          created_at?: string
          equipment_id: string
          id?: string
          method?: string | null
          notes?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          certified_at?: string
          certified_by?: string
          created_at?: string
          equipment_id?: string
          id?: string
          method?: string | null
          notes?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loto_zero_energy_certifications_certified_by_fkey"
            columns: ["certified_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_zero_energy_certifications_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "loto_equipment"
            referencedColumns: ["equipment_id"]
          },
          {
            foreignKeyName: "loto_zero_energy_certifications_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loto_zero_energy_certifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      management_reviews: {
        Row: {
          attendees: string | null
          chaired_by: string | null
          conclusions: string | null
          created_at: string
          created_by: string | null
          decisions: string | null
          id: string
          inputs_summary: string | null
          period_end: string | null
          period_start: string | null
          review_date: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attendees?: string | null
          chaired_by?: string | null
          conclusions?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: string | null
          id?: string
          inputs_summary?: string | null
          period_end?: string | null
          period_start?: string | null
          review_date?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attendees?: string | null
          chaired_by?: string | null
          conclusions?: string | null
          created_at?: string
          created_by?: string | null
          decisions?: string | null
          id?: string
          inputs_summary?: string | null
          period_end?: string | null
          period_start?: string | null
          review_date?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "management_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_versions: {
        Row: {
          body_md: string
          change_note: string | null
          created_at: string
          created_by: string | null
          id: string
          manual_id: string
          summary: string | null
          title: string
          version: number
        }
        Insert: {
          body_md: string
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_id: string
          summary?: string | null
          title: string
          version: number
        }
        Update: {
          body_md?: string
          change_note?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          manual_id?: string
          summary?: string | null
          title?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "manual_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_versions_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      manuals: {
        Row: {
          body_md: string
          body_tsv: unknown
          created_at: string
          created_by: string | null
          id: string
          module_id: string
          published_at: string | null
          summary: string | null
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          body_md?: string
          body_tsv?: unknown
          created_at?: string
          created_by?: string | null
          id?: string
          module_id: string
          published_at?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          body_md?: string
          body_tsv?: unknown
          created_at?: string
          created_by?: string | null
          id?: string
          module_id?: string
          published_at?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "manuals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manuals_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_custom_field_definitions: {
        Row: {
          active: boolean
          created_at: string
          edit_scope: string
          field_key: string
          field_type: string
          id: string
          label: string
          options: Json
          required: boolean
          sort_order: number
          tenant_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          edit_scope?: string
          field_key: string
          field_type?: string
          id?: string
          label: string
          options?: Json
          required?: boolean
          sort_order?: number
          tenant_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          edit_scope?: string
          field_key?: string
          field_type?: string
          id?: string
          label?: string
          options?: Json
          required?: boolean
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_custom_field_definitions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_custom_field_values: {
        Row: {
          field_id: string
          member_id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          value: Json | null
        }
        Insert: {
          field_id: string
          member_id: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
        }
        Update: {
          field_id?: string
          member_id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "member_custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "member_custom_field_definitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_custom_field_values_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_custom_field_values_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_custom_field_values_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_custom_field_values_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_custom_field_values_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_drift_findings: {
        Row: {
          details: Json
          detected_at: string
          finding_type: string
          id: string
          member_id: string | null
          reconciled_at: string | null
          surface: string
          surface_row_pk: string
          tenant_id: string
        }
        Insert: {
          details?: Json
          detected_at?: string
          finding_type: string
          id?: string
          member_id?: string | null
          reconciled_at?: string | null
          surface: string
          surface_row_pk: string
          tenant_id: string
        }
        Update: {
          details?: Json
          detected_at?: string
          finding_type?: string
          id?: string
          member_id?: string | null
          reconciled_at?: string | null
          surface?: string
          surface_row_pk?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_drift_findings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_drift_findings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_drift_findings_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_drift_findings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_identifier_hashes: {
        Row: {
          created_at: string
          id: string
          identifier_type: string
          member_id: string
          search_key_hash: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          identifier_type: string
          member_id: string
          search_key_hash: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          id?: string
          identifier_type?: string
          member_id?: string
          search_key_hash?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_identifier_hashes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_identifier_hashes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_identifier_hashes_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_identifier_hashes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_merges: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          reason: string | null
          source_member_id: string
          target_member_id: string
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          source_member_id: string
          target_member_id: string
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          reason?: string | null
          source_member_id?: string
          target_member_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_merges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      member_status_events: {
        Row: {
          actor_user_id: string | null
          created_at: string
          event_type: string
          id: string
          member_id: string
          new_values: Json | null
          old_values: Json | null
          reason: string | null
          tenant_id: string
        }
        Insert: {
          actor_user_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          member_id: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          tenant_id: string
        }
        Update: {
          actor_user_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          member_id?: string
          new_values?: Json | null
          old_values?: Json | null
          reason?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_status_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_status_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_status_events_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "member_status_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          badge_id: string | null
          created_at: string
          created_by: string | null
          department: string | null
          display_name: string
          display_name_source: string
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_id: string | null
          employment_type: string
          external_hris_id: string | null
          handle: string
          hire_date: string | null
          id: string
          language: string | null
          legal_name: string | null
          member_code: string
          merged_into_member_id: string | null
          metadata: Json
          notes: string | null
          notification_preferences: Json
          phone: string | null
          position_title: string | null
          preferred_name: string | null
          profile_id: string | null
          pronouns: string | null
          readiness_status: string
          sensitive_safety_notes: string | null
          shift_label: string | null
          site_label: string | null
          source: string
          source_id: string | null
          start_date: string | null
          status: string
          status_reason: string | null
          supervisor_member_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          vendor_company: string | null
        }
        Insert: {
          badge_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          display_name: string
          display_name_source?: string
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_id?: string | null
          employment_type?: string
          external_hris_id?: string | null
          handle: string
          hire_date?: string | null
          id?: string
          language?: string | null
          legal_name?: string | null
          member_code: string
          merged_into_member_id?: string | null
          metadata?: Json
          notes?: string | null
          notification_preferences?: Json
          phone?: string | null
          position_title?: string | null
          preferred_name?: string | null
          profile_id?: string | null
          pronouns?: string | null
          readiness_status?: string
          sensitive_safety_notes?: string | null
          shift_label?: string | null
          site_label?: string | null
          source?: string
          source_id?: string | null
          start_date?: string | null
          status?: string
          status_reason?: string | null
          supervisor_member_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          vendor_company?: string | null
        }
        Update: {
          badge_id?: string | null
          created_at?: string
          created_by?: string | null
          department?: string | null
          display_name?: string
          display_name_source?: string
          email?: string | null
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          employee_id?: string | null
          employment_type?: string
          external_hris_id?: string | null
          handle?: string
          hire_date?: string | null
          id?: string
          language?: string | null
          legal_name?: string | null
          member_code?: string
          merged_into_member_id?: string | null
          metadata?: Json
          notes?: string | null
          notification_preferences?: Json
          phone?: string | null
          position_title?: string | null
          preferred_name?: string | null
          profile_id?: string | null
          pronouns?: string | null
          readiness_status?: string
          sensitive_safety_notes?: string | null
          shift_label?: string | null
          site_label?: string | null
          source?: string
          source_id?: string | null
          start_date?: string | null
          status?: string
          status_reason?: string | null
          supervisor_member_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          vendor_company?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_merged_into_member_id_fkey"
            columns: ["merged_into_member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_merged_into_member_id_fkey"
            columns: ["merged_into_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_merged_into_member_id_fkey"
            columns: ["merged_into_member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_supervisor_member_id_fkey"
            columns: ["supervisor_member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_supervisor_member_id_fkey"
            columns: ["supervisor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_supervisor_member_id_fkey"
            columns: ["supervisor_member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      mentions: {
        Row: {
          author_user_id: string
          created_at: string
          id: string
          mentioned_user_id: string
          read_at: string | null
          source_id: string
          source_type: string
          tenant_id: string
        }
        Insert: {
          author_user_id: string
          created_at?: string
          id?: string
          mentioned_user_id: string
          read_at?: string | null
          source_id: string
          source_type: string
          tenant_id: string
        }
        Update: {
          author_user_id?: string
          created_at?: string
          id?: string
          mentioned_user_id?: string
          read_at?: string | null
          source_id?: string
          source_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mentions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      near_miss_ai_insights: {
        Row: {
          escalation_risk: string
          generated_at: string
          model: string
          near_miss_id: string
          rationale: string | null
          tenant_id: string
          themes: string[]
        }
        Insert: {
          escalation_risk: string
          generated_at?: string
          model: string
          near_miss_id: string
          rationale?: string | null
          tenant_id: string
          themes?: string[]
        }
        Update: {
          escalation_risk?: string
          generated_at?: string
          model?: string
          near_miss_id?: string
          rationale?: string | null
          tenant_id?: string
          themes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "near_miss_ai_insights_near_miss_id_fkey"
            columns: ["near_miss_id"]
            isOneToOne: true
            referencedRelation: "near_misses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "near_miss_ai_insights_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      near_miss_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          after_row: Json | null
          before_row: Json | null
          context: string | null
          event_type: string
          id: number
          near_miss_id: string
          occurred_at: string
          tenant_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type: string
          id?: number
          near_miss_id: string
          occurred_at?: string
          tenant_id?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type?: string
          id?: number
          near_miss_id?: string
          occurred_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "near_miss_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      near_miss_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id?: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "near_miss_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      near_misses: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string
          escalated_to_risk_id: string | null
          facility_id: string | null
          hazard_category: string
          id: string
          immediate_action_taken: string | null
          linked_risk_id: string | null
          location: string | null
          migrated_to_incident_id: string | null
          occurred_at: string
          report_number: string | null
          reported_at: string
          reported_by: string
          resolution_notes: string | null
          resolved_at: string | null
          severity_potential: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description: string
          escalated_to_risk_id?: string | null
          facility_id?: string | null
          hazard_category: string
          id?: string
          immediate_action_taken?: string | null
          linked_risk_id?: string | null
          location?: string | null
          migrated_to_incident_id?: string | null
          occurred_at: string
          report_number?: string | null
          reported_at?: string
          reported_by: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity_potential: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string
          escalated_to_risk_id?: string | null
          facility_id?: string | null
          hazard_category?: string
          id?: string
          immediate_action_taken?: string | null
          linked_risk_id?: string | null
          location?: string | null
          migrated_to_incident_id?: string | null
          occurred_at?: string
          report_number?: string | null
          reported_at?: string
          reported_by?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          severity_potential?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "near_misses_escalated_to_risk_id_fkey"
            columns: ["escalated_to_risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "near_misses_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "near_misses_linked_risk_id_fkey"
            columns: ["linked_risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "near_misses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      nfpa704_legend: {
        Row: {
          category: string
          created_at: string
          meaning: string
          quadrant_color: string
          rating: number | null
          special_symbol: string | null
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          meaning: string
          quadrant_color: string
          rating?: number | null
          special_symbol?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          meaning?: string
          quadrant_color?: string
          rating?: number | null
          special_symbol?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      nonconformities: {
        Row: {
          classification: string
          clause_ref: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          identified_at: string
          identified_by: string | null
          notes: string | null
          owner_user_id: string | null
          related_aspect_id: string | null
          related_objective_id: string | null
          source_reference: string | null
          source_type: string
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          classification?: string
          clause_ref?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          identified_at?: string
          identified_by?: string | null
          notes?: string | null
          owner_user_id?: string | null
          related_aspect_id?: string | null
          related_objective_id?: string | null
          source_reference?: string | null
          source_type?: string
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          classification?: string
          clause_ref?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          identified_at?: string
          identified_by?: string | null
          notes?: string | null
          owner_user_id?: string | null
          related_aspect_id?: string | null
          related_objective_id?: string | null
          source_reference?: string | null
          source_type?: string
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nonconformities_related_aspect_id_fkey"
            columns: ["related_aspect_id"]
            isOneToOne: false
            referencedRelation: "environmental_aspects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nonconformities_related_objective_id_fkey"
            columns: ["related_objective_id"]
            isOneToOne: false
            referencedRelation: "environmental_objectives"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nonconformities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      nonconformity_actions: {
        Row: {
          action_type: string
          assigned_to_user_id: string | null
          completed_at: string | null
          completed_by_user_id: string | null
          created_at: string
          created_by_user_id: string | null
          description: string
          due_at: string | null
          id: string
          nonconformity_id: string
          status: string
          tenant_id: string
          updated_at: string
          verification_notes: string | null
          verified_by_user_id: string | null
          verified_effective_at: string | null
        }
        Insert: {
          action_type?: string
          assigned_to_user_id?: string | null
          completed_at?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description: string
          due_at?: string | null
          id?: string
          nonconformity_id: string
          status?: string
          tenant_id: string
          updated_at?: string
          verification_notes?: string | null
          verified_by_user_id?: string | null
          verified_effective_at?: string | null
        }
        Update: {
          action_type?: string
          assigned_to_user_id?: string | null
          completed_at?: string | null
          completed_by_user_id?: string | null
          created_at?: string
          created_by_user_id?: string | null
          description?: string
          due_at?: string | null
          id?: string
          nonconformity_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          verification_notes?: string | null
          verified_by_user_id?: string | null
          verified_effective_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "nonconformity_actions_nonconformity_id_fkey"
            columns: ["nonconformity_id"]
            isOneToOne: false
            referencedRelation: "nonconformities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "nonconformity_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_channels: {
        Row: {
          active: boolean
          config: Json
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          name: string
          tenant_id: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          config?: Json
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          name: string
          tenant_id: string
          type: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          config?: Json
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          tenant_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_channels_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_rules: {
        Row: {
          active: boolean
          channel_id: string
          created_at: string
          created_by: string | null
          event_type: string
          id: string
          min_severity: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          channel_id: string
          created_at?: string
          created_by?: string | null
          event_type: string
          id?: string
          min_severity?: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          channel_id?: string
          created_at?: string
          created_by?: string | null
          event_type?: string
          id?: string
          min_severity?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_rules_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "notification_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          href: string | null
          id: string
          read_at: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          href?: string | null
          id?: string
          read_at?: string | null
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_conversations: {
        Row: {
          id: string
          last_message_at: string
          origin_path: string | null
          started_at: string
          tenant_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          id?: string
          last_message_at?: string
          origin_path?: string | null
          started_at?: string
          tenant_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          id?: string
          last_message_at?: string
          origin_path?: string | null
          started_at?: string
          tenant_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operator_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operator_messages: {
        Row: {
          cache_read_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          input_tokens: number | null
          metadata: Json | null
          output_tokens: number | null
          role: string
        }
        Insert: {
          cache_read_tokens?: number | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          role: string
        }
        Update: {
          cache_read_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          input_tokens?: number | null
          metadata?: Json | null
          output_tokens?: number | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "operator_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      osha_300_log_entries: {
        Row: {
          case_number: string
          classification: string
          date_of_injury: string
          days_away: number
          days_restricted: number
          employee_name: string | null
          establishment_id: string | null
          facility_id: string | null
          id: string
          incident_id: string
          injury_description: string | null
          injury_type: string
          is_privacy_case: boolean
          job_title: string | null
          location_text: string | null
          refreshed_at: string
          tenant_id: string
          year: number
        }
        Insert: {
          case_number: string
          classification: string
          date_of_injury: string
          days_away?: number
          days_restricted?: number
          employee_name?: string | null
          establishment_id?: string | null
          facility_id?: string | null
          id?: string
          incident_id: string
          injury_description?: string | null
          injury_type?: string
          is_privacy_case?: boolean
          job_title?: string | null
          location_text?: string | null
          refreshed_at?: string
          tenant_id: string
          year: number
        }
        Update: {
          case_number?: string
          classification?: string
          date_of_injury?: string
          days_away?: number
          days_restricted?: number
          employee_name?: string | null
          establishment_id?: string | null
          facility_id?: string | null
          id?: string
          incident_id?: string
          injury_description?: string | null
          injury_type?: string
          is_privacy_case?: boolean
          job_title?: string | null
          location_text?: string | null
          refreshed_at?: string
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "osha_300_log_entries_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "osha_establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "osha_300_log_entries_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "osha_establishments_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "osha_300_log_entries_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "osha_300_log_entries_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "osha_300_log_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      osha_annual_summaries: {
        Row: {
          annual_avg_employees: number
          certified_at: string | null
          certified_by: string | null
          certified_typed_name: string | null
          created_at: string
          establishment_id: string
          id: string
          ita_response_json: Json | null
          ita_submission_id: string | null
          posted_at: string | null
          submitted_by: string | null
          submitted_to_ita_at: string | null
          tenant_id: string
          total_hours_worked: number
          totals_json: Json
          updated_at: string
          year: number
        }
        Insert: {
          annual_avg_employees: number
          certified_at?: string | null
          certified_by?: string | null
          certified_typed_name?: string | null
          created_at?: string
          establishment_id: string
          id?: string
          ita_response_json?: Json | null
          ita_submission_id?: string | null
          posted_at?: string | null
          submitted_by?: string | null
          submitted_to_ita_at?: string | null
          tenant_id: string
          total_hours_worked: number
          totals_json: Json
          updated_at?: string
          year: number
        }
        Update: {
          annual_avg_employees?: number
          certified_at?: string | null
          certified_by?: string | null
          certified_typed_name?: string | null
          created_at?: string
          establishment_id?: string
          id?: string
          ita_response_json?: Json | null
          ita_submission_id?: string | null
          posted_at?: string | null
          submitted_by?: string | null
          submitted_to_ita_at?: string | null
          tenant_id?: string
          total_hours_worked?: number
          totals_json?: Json
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "osha_annual_summaries_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "osha_establishments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "osha_annual_summaries_establishment_id_fkey"
            columns: ["establishment_id"]
            isOneToOne: false
            referencedRelation: "osha_establishments_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "osha_annual_summaries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      osha_establishments: {
        Row: {
          certifying_executive_name: string | null
          certifying_executive_title: string | null
          city: string | null
          created_at: string
          created_by: string | null
          establishment_name: string
          hours_employees_by_year: Json
          id: string
          is_partial_year: boolean
          ita_api_token: string | null
          ita_auto_submit_enabled: boolean
          ita_auto_submit_last_attempt_at: string | null
          ita_auto_submit_last_error: string | null
          ita_establishment_id: string | null
          naics_code: string | null
          state: string | null
          street: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          zip: string | null
        }
        Insert: {
          certifying_executive_name?: string | null
          certifying_executive_title?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          establishment_name: string
          hours_employees_by_year?: Json
          id?: string
          is_partial_year?: boolean
          ita_api_token?: string | null
          ita_auto_submit_enabled?: boolean
          ita_auto_submit_last_attempt_at?: string | null
          ita_auto_submit_last_error?: string | null
          ita_establishment_id?: string | null
          naics_code?: string | null
          state?: string | null
          street?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          zip?: string | null
        }
        Update: {
          certifying_executive_name?: string | null
          certifying_executive_title?: string | null
          city?: string | null
          created_at?: string
          created_by?: string | null
          establishment_name?: string
          hours_employees_by_year?: Json
          id?: string
          is_partial_year?: boolean
          ita_api_token?: string | null
          ita_auto_submit_enabled?: boolean
          ita_auto_submit_last_attempt_at?: string | null
          ita_auto_submit_last_error?: string | null
          ita_establishment_id?: string | null
          naics_code?: string | null
          state?: string | null
          street?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "osha_establishments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      osha_regulation_updates: {
        Row: {
          ai_model: string | null
          category: string
          comment_close_date: string | null
          created_at: string
          dedup_key: string
          effective_date: string | null
          fetched_at: string
          id: string
          impact_summary: string
          is_upcoming: boolean
          jurisdiction: string
          published_date: string | null
          severity: string | null
          source_url: string
          title: string
          updated_at: string
        }
        Insert: {
          ai_model?: string | null
          category: string
          comment_close_date?: string | null
          created_at?: string
          dedup_key: string
          effective_date?: string | null
          fetched_at?: string
          id?: string
          impact_summary: string
          is_upcoming?: boolean
          jurisdiction?: string
          published_date?: string | null
          severity?: string | null
          source_url: string
          title: string
          updated_at?: string
        }
        Update: {
          ai_model?: string | null
          category?: string
          comment_close_date?: string | null
          created_at?: string
          dedup_key?: string
          effective_date?: string | null
          fetched_at?: string
          id?: string
          impact_summary?: string
          is_upcoming?: boolean
          jurisdiction?: string
          published_date?: string | null
          severity?: string | null
          source_url?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      phi_access_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          context: string | null
          id: number
          incident_id: string | null
          occurred_at: string
          resource_id: string | null
          resource_type: string
          tenant_id: string
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          context?: string | null
          id?: number
          incident_id?: string | null
          occurred_at?: string
          resource_id?: string | null
          resource_type: string
          tenant_id: string
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          context?: string | null
          id?: number
          incident_id?: string | null
          occurred_at?: string
          resource_id?: string | null
          resource_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phi_access_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      position_course_requirements: {
        Row: {
          course_id: string
          created_at: string
          id: string
          notes: string | null
          position_id: string
          required: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          notes?: string | null
          position_id: string
          required?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          position_id?: string
          required?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_course_requirements_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "training_courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_course_requirements_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "worker_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_course_requirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      position_equipment_requirements: {
        Row: {
          created_at: string
          equipment_family: string
          id: string
          position_id: string
          required: boolean
          requirement_label: string
          source_note: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          equipment_family: string
          id?: string
          position_id: string
          required?: boolean
          requirement_label: string
          source_note?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          equipment_family?: string
          id?: string
          position_id?: string
          required?: boolean
          requirement_label?: string
          source_note?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_equipment_requirements_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "worker_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_equipment_requirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      position_training_requirements: {
        Row: {
          created_at: string
          id: string
          position_id: string
          recurrence_months: number | null
          required: boolean
          requirement_label: string
          role: string
          source_note: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          position_id: string
          recurrence_months?: number | null
          required?: boolean
          requirement_label: string
          role: string
          source_note?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          position_id?: string
          recurrence_months?: number | null
          required?: boolean
          requirement_label?: string
          role?: string
          source_note?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "position_training_requirements_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "worker_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "position_training_requirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          is_admin: boolean
          is_superadmin: boolean
          must_change_password: boolean
          onboarding_completed_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          is_admin?: boolean
          is_superadmin?: boolean
          must_change_password?: boolean
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          is_admin?: boolean
          is_superadmin?: boolean
          must_change_password?: boolean
          onboarding_completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_areas: {
        Row: {
          ancestor_ids: string[]
          code: string | null
          created_at: string
          created_by: string | null
          depth: number | null
          id: string
          kind: string
          label_path: string
          name: string
          parent_id: string | null
          project_id: string
          sort_order: number
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ancestor_ids?: string[]
          code?: string | null
          created_at?: string
          created_by?: string | null
          depth?: number | null
          id?: string
          kind?: string
          label_path: string
          name: string
          parent_id?: string | null
          project_id: string
          sort_order?: number
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ancestor_ids?: string[]
          code?: string | null
          created_at?: string
          created_by?: string | null
          depth?: number | null
          id?: string
          kind?: string
          label_path?: string
          name?: string
          parent_id?: string | null
          project_id?: string
          sort_order?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_areas_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "project_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_areas_project_fk"
            columns: ["tenant_id", "project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_areas_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_calendar: {
        Row: {
          calendar_date: string
          created_at: string
          heat_index_f: number | null
          high_temp_f: number | null
          is_working_day: boolean
          low_temp_f: number | null
          non_working_reason: string | null
          note: string | null
          project_id: string
          tenant_id: string
          updated_at: string
          weather_source: string | null
          work_day_ordinal: number | null
        }
        Insert: {
          calendar_date: string
          created_at?: string
          heat_index_f?: number | null
          high_temp_f?: number | null
          is_working_day: boolean
          low_temp_f?: number | null
          non_working_reason?: string | null
          note?: string | null
          project_id: string
          tenant_id: string
          updated_at?: string
          weather_source?: string | null
          work_day_ordinal?: number | null
        }
        Update: {
          calendar_date?: string
          created_at?: string
          heat_index_f?: number | null
          high_temp_f?: number | null
          is_working_day?: boolean
          low_temp_f?: number | null
          non_working_reason?: string | null
          note?: string | null
          project_id?: string
          tenant_id?: string
          updated_at?: string
          weather_source?: string | null
          work_day_ordinal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "project_calendar_project_fk"
            columns: ["tenant_id", "project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_calendar_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_companies: {
        Row: {
          ancestor_company_ids: string[]
          company_name: string
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          hired_by_company_id: string | null
          id: string
          legal_name: string | null
          license_number: string | null
          onsite_end_date: string | null
          onsite_start_date: string | null
          project_id: string
          role: string
          scope_of_work: string | null
          status: string
          tenant_id: string
          tier: number | null
          trade: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ancestor_company_ids?: string[]
          company_name: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          hired_by_company_id?: string | null
          id?: string
          legal_name?: string | null
          license_number?: string | null
          onsite_end_date?: string | null
          onsite_start_date?: string | null
          project_id: string
          role?: string
          scope_of_work?: string | null
          status?: string
          tenant_id: string
          tier?: number | null
          trade?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ancestor_company_ids?: string[]
          company_name?: string
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          hired_by_company_id?: string | null
          id?: string
          legal_name?: string | null
          license_number?: string | null
          onsite_end_date?: string | null
          onsite_start_date?: string | null
          project_id?: string
          role?: string
          scope_of_work?: string | null
          status?: string
          tenant_id?: string
          tier?: number | null
          trade?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_companies_hired_by_company_id_fkey"
            columns: ["hired_by_company_id"]
            isOneToOne: false
            referencedRelation: "project_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_companies_project_fk"
            columns: ["tenant_id", "project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_companies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_presence: {
        Row: {
          area_id: string | null
          created_at: string
          first_seen_at: string
          id: string
          last_seen_at: string
          member_id: string
          presence_date: string
          project_company_id: string | null
          project_id: string
          source: string
          source_record_id: string | null
          source_record_type: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          area_id?: string | null
          created_at?: string
          first_seen_at: string
          id?: string
          last_seen_at: string
          member_id: string
          presence_date: string
          project_company_id?: string | null
          project_id: string
          source: string
          source_record_id?: string | null
          source_record_type?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          area_id?: string | null
          created_at?: string
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          member_id?: string
          presence_date?: string
          project_company_id?: string | null
          project_id?: string
          source?: string
          source_record_id?: string | null
          source_record_type?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_presence_area_id_fkey"
            columns: ["area_id"]
            isOneToOne: false
            referencedRelation: "project_areas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_presence_company_fk"
            columns: ["tenant_id", "project_company_id"]
            isOneToOne: false
            referencedRelation: "project_companies"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_presence_member_fk"
            columns: ["tenant_id", "member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_presence_member_fk"
            columns: ["tenant_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_presence_member_fk"
            columns: ["tenant_id", "member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["tenant_id", "member_id"]
          },
          {
            foreignKeyName: "project_presence_project_fk"
            columns: ["tenant_id", "project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_presence_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      project_workers: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          is_supervisory: boolean
          member_id: string
          offboarded_on: string | null
          onboarded_on: string | null
          orientation_completed_at: string | null
          project_company_id: string
          project_id: string
          role_on_project: string
          site_badge_number: string | null
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_supervisory?: boolean
          member_id: string
          offboarded_on?: string | null
          onboarded_on?: string | null
          orientation_completed_at?: string | null
          project_company_id: string
          project_id: string
          role_on_project?: string
          site_badge_number?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          is_supervisory?: boolean
          member_id?: string
          offboarded_on?: string | null
          onboarded_on?: string | null
          orientation_completed_at?: string | null
          project_company_id?: string
          project_id?: string
          role_on_project?: string
          site_badge_number?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_workers_company_fk"
            columns: ["tenant_id", "project_company_id"]
            isOneToOne: false
            referencedRelation: "project_companies"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_workers_member_fk"
            columns: ["tenant_id", "member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_workers_member_fk"
            columns: ["tenant_id", "member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_workers_member_fk"
            columns: ["tenant_id", "member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["tenant_id", "member_id"]
          },
          {
            foreignKeyName: "project_workers_project_fk"
            columns: ["tenant_id", "project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "project_workers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_annual_reviews: {
        Row: {
          corrective_actions: string | null
          created_at: string
          deviations: string | null
          id: string
          next_due_at: string
          review_year: number
          reviewed_at: string
          reviewer_user_id: string | null
          signed: boolean
          signed_at: string | null
          signed_name: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          corrective_actions?: string | null
          created_at?: string
          deviations?: string | null
          id?: string
          next_due_at?: string
          review_year: number
          reviewed_at?: string
          reviewer_user_id?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          corrective_actions?: string | null
          created_at?: string
          deviations?: string | null
          id?: string
          next_due_at?: string
          review_year?: number
          reviewed_at?: string
          reviewer_user_id?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop65_annual_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_chemical_links: {
        Row: {
          chemical_inventory_id: string
          confidence: Database["public"]["Enums"]["prop65_link_confidence"]
          created_at: string
          id: string
          linked_at: string
          linked_by_user_id: string | null
          notes: string | null
          prop65_chemical_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          chemical_inventory_id: string
          confidence?: Database["public"]["Enums"]["prop65_link_confidence"]
          created_at?: string
          id?: string
          linked_at?: string
          linked_by_user_id?: string | null
          notes?: string | null
          prop65_chemical_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          chemical_inventory_id?: string
          confidence?: Database["public"]["Enums"]["prop65_link_confidence"]
          created_at?: string
          id?: string
          linked_at?: string
          linked_by_user_id?: string | null
          notes?: string | null
          prop65_chemical_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop65_chemical_links_chemical_inventory_id_fkey"
            columns: ["chemical_inventory_id"]
            isOneToOne: false
            referencedRelation: "chemical_inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_chemical_links_chemical_inventory_id_fkey"
            columns: ["chemical_inventory_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_chemical_links_prop65_chemical_id_fkey"
            columns: ["prop65_chemical_id"]
            isOneToOne: false
            referencedRelation: "prop65_chemicals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_chemical_links_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_chemicals: {
        Row: {
          cas_number: string
          chemical_name: string
          created_at: string
          harm_endpoint: Database["public"]["Enums"]["prop65_harm_endpoint"]
          id: string
          listing_date: string | null
          madl_mg_day: number | null
          nsrl_mg_day: number | null
          source_publication: string | null
          updated_at: string
        }
        Insert: {
          cas_number: string
          chemical_name: string
          created_at?: string
          harm_endpoint: Database["public"]["Enums"]["prop65_harm_endpoint"]
          id?: string
          listing_date?: string | null
          madl_mg_day?: number | null
          nsrl_mg_day?: number | null
          source_publication?: string | null
          updated_at?: string
        }
        Update: {
          cas_number?: string
          chemical_name?: string
          created_at?: string
          harm_endpoint?: Database["public"]["Enums"]["prop65_harm_endpoint"]
          id?: string
          listing_date?: string | null
          madl_mg_day?: number | null
          nsrl_mg_day?: number | null
          source_publication?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      prop65_exposure_assessments: {
        Row: {
          assessed_at: string
          assessor_user_id: string | null
          below_safe_harbor: boolean | null
          chemical_inventory_id: string
          created_at: string
          estimated_daily_intake_mg: number | null
          exposure_route: Database["public"]["Enums"]["prop65_exposure_route"]
          id: string
          methodology_notes: string | null
          signed: boolean
          signed_at: string | null
          signed_name: string | null
          site_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          assessed_at?: string
          assessor_user_id?: string | null
          below_safe_harbor?: boolean | null
          chemical_inventory_id: string
          created_at?: string
          estimated_daily_intake_mg?: number | null
          exposure_route: Database["public"]["Enums"]["prop65_exposure_route"]
          id?: string
          methodology_notes?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          site_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          assessed_at?: string
          assessor_user_id?: string | null
          below_safe_harbor?: boolean | null
          chemical_inventory_id?: string
          created_at?: string
          estimated_daily_intake_mg?: number | null
          exposure_route?: Database["public"]["Enums"]["prop65_exposure_route"]
          id?: string
          methodology_notes?: string | null
          signed?: boolean
          signed_at?: string | null
          signed_name?: string | null
          site_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop65_exposure_assessments_chemical_inventory_id_fkey"
            columns: ["chemical_inventory_id"]
            isOneToOne: false
            referencedRelation: "chemical_inventory_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_exposure_assessments_chemical_inventory_id_fkey"
            columns: ["chemical_inventory_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_expiring_soon"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_exposure_assessments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "prop65_compliance_status"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "prop65_exposure_assessments_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "prop65_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_exposure_assessments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_notifications: {
        Row: {
          confirmed_by_worker_at: string | null
          created_at: string
          id: string
          notes: string | null
          notification_method: Database["public"]["Enums"]["prop65_notification_method"]
          notified_at: string
          site_id: string
          tenant_id: string
          training_record_id: string | null
          worker_id: string | null
        }
        Insert: {
          confirmed_by_worker_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          notification_method: Database["public"]["Enums"]["prop65_notification_method"]
          notified_at?: string
          site_id: string
          tenant_id: string
          training_record_id?: string | null
          worker_id?: string | null
        }
        Update: {
          confirmed_by_worker_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          notification_method?: Database["public"]["Enums"]["prop65_notification_method"]
          notified_at?: string
          site_id?: string
          tenant_id?: string
          training_record_id?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prop65_notifications_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "prop65_compliance_status"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "prop65_notifications_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "prop65_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_notifications_training_record_id_fkey"
            columns: ["training_record_id"]
            isOneToOne: false
            referencedRelation: "loto_training_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_notifications_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_worker_retraining_status"
            referencedColumns: ["worker_id"]
          },
          {
            foreignKeyName: "prop65_notifications_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_sites: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          employee_count: number | null
          id: string
          name: string
          public_slug: string
          state: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          employee_count?: number | null
          id?: string
          name: string
          public_slug: string
          state?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          employee_count?: number | null
          id?: string
          name?: string
          public_slug?: string
          state?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prop65_sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_warnings: {
        Row: {
          created_at: string
          harm_endpoint: Database["public"]["Enums"]["prop65_harm_endpoint"]
          id: string
          photo_url: string | null
          posted_at: string
          posted_by_user_id: string | null
          prop65_chemical_ids: string[]
          removed_at: string | null
          removed_by_user_id: string | null
          site_id: string
          tenant_id: string
          updated_at: string
          warning_text: string
          warning_type: Database["public"]["Enums"]["prop65_warning_type"]
        }
        Insert: {
          created_at?: string
          harm_endpoint: Database["public"]["Enums"]["prop65_harm_endpoint"]
          id?: string
          photo_url?: string | null
          posted_at?: string
          posted_by_user_id?: string | null
          prop65_chemical_ids?: string[]
          removed_at?: string | null
          removed_by_user_id?: string | null
          site_id: string
          tenant_id: string
          updated_at?: string
          warning_text: string
          warning_type: Database["public"]["Enums"]["prop65_warning_type"]
        }
        Update: {
          created_at?: string
          harm_endpoint?: Database["public"]["Enums"]["prop65_harm_endpoint"]
          id?: string
          photo_url?: string | null
          posted_at?: string
          posted_by_user_id?: string | null
          prop65_chemical_ids?: string[]
          removed_at?: string | null
          removed_by_user_id?: string | null
          site_id?: string
          tenant_id?: string
          updated_at?: string
          warning_text?: string
          warning_type?: Database["public"]["Enums"]["prop65_warning_type"]
        }
        Relationships: [
          {
            foreignKeyName: "prop65_warnings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "prop65_compliance_status"
            referencedColumns: ["site_id"]
          },
          {
            foreignKeyName: "prop65_warnings_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "prop65_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prop65_warnings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_token_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          after_row: Json | null
          before_row: Json | null
          context: string | null
          event_type: string
          id: number
          occurred_at: string
          tenant_id: string
          token_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type: string
          id?: number
          occurred_at?: string
          tenant_id: string
          token_id: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type?: string
          id?: number
          occurred_at?: string
          tenant_id?: string
          token_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qr_token_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      regulation_update_checks: {
        Row: {
          created_at: string
          ecfr_part: string
          ecfr_title: string
          ingested_at: string | null
          ingested_snapshot: string | null
          last_checked_at: string | null
          last_notified_at: string | null
          latest_amendment: string | null
          needs_update: boolean
          source: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ecfr_part: string
          ecfr_title: string
          ingested_at?: string | null
          ingested_snapshot?: string | null
          last_checked_at?: string | null
          last_notified_at?: string | null
          latest_amendment?: string | null
          needs_update?: boolean
          source: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ecfr_part?: string
          ecfr_title?: string
          ingested_at?: string | null
          ingested_snapshot?: string | null
          last_checked_at?: string | null
          last_notified_at?: string | null
          latest_amendment?: string | null
          needs_update?: boolean
          source?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      release_notes: {
        Row: {
          body_md: string
          created_at: string
          created_by: string | null
          id: number
          published_at: string | null
          title: string
          updated_at: string
          version: string
        }
        Insert: {
          body_md: string
          created_at?: string
          created_by?: string | null
          id?: number
          published_at?: string | null
          title: string
          updated_at?: string
          version: string
        }
        Update: {
          body_md?: string
          created_at?: string
          created_by?: string | null
          id?: number
          published_at?: string | null
          title?: string
          updated_at?: string
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_notes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_attachments: {
        Row: {
          attachment_type: string | null
          content_type: string | null
          description: string | null
          file_name: string
          file_size_bytes: number | null
          id: string
          risk_id: string
          storage_path: string
          tenant_id: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          attachment_type?: string | null
          content_type?: string | null
          description?: string | null
          file_name: string
          file_size_bytes?: number | null
          id?: string
          risk_id: string
          storage_path: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          attachment_type?: string | null
          content_type?: string | null
          description?: string | null
          file_name?: string
          file_size_bytes?: number | null
          id?: string
          risk_id?: string
          storage_path?: string
          tenant_id?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_attachments_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_audit_log: {
        Row: {
          actor_email: string | null
          actor_id: string | null
          after_row: Json | null
          before_row: Json | null
          context: string | null
          event_type: string
          id: number
          occurred_at: string
          risk_id: string
          tenant_id: string
        }
        Insert: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type: string
          id?: number
          occurred_at?: string
          risk_id: string
          tenant_id?: string
        }
        Update: {
          actor_email?: string | null
          actor_id?: string | null
          after_row?: Json | null
          before_row?: Json | null
          context?: string | null
          event_type?: string
          id?: number
          occurred_at?: string
          risk_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_audit_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_controls: {
        Row: {
          control_id: string | null
          created_at: string
          created_by: string
          custom_name: string | null
          hierarchy_level: string
          id: string
          implemented_at: string | null
          notes: string | null
          risk_id: string
          status: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          control_id?: string | null
          created_at?: string
          created_by: string
          custom_name?: string | null
          hierarchy_level: string
          id?: string
          implemented_at?: string | null
          notes?: string | null
          risk_id: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          control_id?: string | null
          created_at?: string
          created_by?: string
          custom_name?: string | null
          hierarchy_level?: string
          id?: string
          implemented_at?: string | null
          notes?: string | null
          risk_id?: string
          status?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_controls_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "controls_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_controls_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_controls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_number_sequences: {
        Row: {
          next_value: number
          tenant_id: string
          year: number
        }
        Insert: {
          next_value?: number
          tenant_id?: string
          year: number
        }
        Update: {
          next_value?: number
          tenant_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "risk_number_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_reviews: {
        Row: {
          created_at: string
          id: string
          inherent_score_at_review: number | null
          notes: string | null
          outcome: string
          residual_score_at_review: number | null
          reviewed_at: string
          reviewed_by: string
          risk_id: string
          tenant_id: string
          trigger: string
        }
        Insert: {
          created_at?: string
          id?: string
          inherent_score_at_review?: number | null
          notes?: string | null
          outcome: string
          residual_score_at_review?: number | null
          reviewed_at?: string
          reviewed_by: string
          risk_id: string
          tenant_id?: string
          trigger: string
        }
        Update: {
          created_at?: string
          id?: string
          inherent_score_at_review?: number | null
          notes?: string | null
          outcome?: string
          residual_score_at_review?: number | null
          reviewed_at?: string
          reviewed_by?: string
          risk_id?: string
          tenant_id?: string
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_reviews_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_reviews_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risks: {
        Row: {
          activity_type: string
          affected_personnel: Json
          approver: string | null
          assigned_to: string | null
          created_at: string
          created_by: string
          description: string
          exposure_frequency: string
          facility_id: string | null
          hazard_category: string
          id: string
          inherent_band: string | null
          inherent_likelihood: number
          inherent_score: number | null
          inherent_severity: number
          last_reviewed_at: string | null
          last_reviewed_by: string | null
          location: string | null
          next_review_date: string | null
          ppe_only_justification: string | null
          process: string | null
          residual_band: string | null
          residual_likelihood: number | null
          residual_score: number | null
          residual_severity: number | null
          reviewer: string | null
          risk_number: string | null
          source: string
          source_ref_id: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          activity_type: string
          affected_personnel?: Json
          approver?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by: string
          description: string
          exposure_frequency: string
          facility_id?: string | null
          hazard_category: string
          id?: string
          inherent_band?: string | null
          inherent_likelihood: number
          inherent_score?: number | null
          inherent_severity: number
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          location?: string | null
          next_review_date?: string | null
          ppe_only_justification?: string | null
          process?: string | null
          residual_band?: string | null
          residual_likelihood?: number | null
          residual_score?: number | null
          residual_severity?: number | null
          reviewer?: string | null
          risk_number?: string | null
          source: string
          source_ref_id?: string | null
          status?: string
          tenant_id?: string
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          activity_type?: string
          affected_personnel?: Json
          approver?: string | null
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          description?: string
          exposure_frequency?: string
          facility_id?: string | null
          hazard_category?: string
          id?: string
          inherent_band?: string | null
          inherent_likelihood?: number
          inherent_score?: number | null
          inherent_severity?: number
          last_reviewed_at?: string | null
          last_reviewed_by?: string | null
          location?: string | null
          next_review_date?: string | null
          ppe_only_justification?: string | null
          process?: string | null
          residual_band?: string | null
          residual_likelihood?: number | null
          residual_score?: number | null
          residual_severity?: number | null
          reviewer?: string | null
          risk_number?: string | null
          source?: string
          source_ref_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_access: {
        Row: {
          board_id: string
          created_at: string
          id: string
          scope_type: string
          scope_value: string
          tenant_id: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          scope_type: string
          scope_value: string
          tenant_id: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          scope_type?: string
          scope_value?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_access_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "safety_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_acknowledgements: {
        Row: {
          acknowledged_at: string
          comment: string | null
          tenant_id: string
          thread_id: string
          thread_title_at_ack: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string
          comment?: string | null
          tenant_id: string
          thread_id: string
          thread_title_at_ack: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string
          comment?: string | null
          tenant_id?: string
          thread_id?: string
          thread_title_at_ack?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_acknowledgements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_acknowledgements_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "safety_board_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_acknowledgements_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "safety_board_trending"
            referencedColumns: ["thread_id"]
          },
        ]
      }
      safety_board_attachments: {
        Row: {
          created_at: string
          filename: string | null
          height: number | null
          id: string
          mime_type: string
          size_bytes: number
          storage_path: string
          target_id: string | null
          target_type: string | null
          tenant_id: string
          uploaded_by: string
          width: number | null
        }
        Insert: {
          created_at?: string
          filename?: string | null
          height?: number | null
          id?: string
          mime_type: string
          size_bytes: number
          storage_path: string
          target_id?: string | null
          target_type?: string | null
          tenant_id: string
          uploaded_by: string
          width?: number | null
        }
        Update: {
          created_at?: string
          filename?: string | null
          height?: number | null
          id?: string
          mime_type?: string
          size_bytes?: number
          storage_path?: string
          target_id?: string | null
          target_type?: string | null
          tenant_id?: string
          uploaded_by?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_attachments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_reactions: {
        Row: {
          created_at: string
          emoji: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          emoji: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          emoji?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_reactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_replies: {
        Row: {
          author_user_id: string
          body: string
          body_mentions: string[]
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          is_anonymous: boolean
          parent_reply_id: string | null
          search_tsv: unknown
          tenant_id: string
          thread_id: string
        }
        Insert: {
          author_user_id: string
          body: string
          body_mentions?: string[]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_anonymous?: boolean
          parent_reply_id?: string | null
          search_tsv?: unknown
          tenant_id: string
          thread_id: string
        }
        Update: {
          author_user_id?: string
          body?: string
          body_mentions?: string[]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_anonymous?: boolean
          parent_reply_id?: string | null
          search_tsv?: unknown
          tenant_id?: string
          thread_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_replies_parent_reply_id_fkey"
            columns: ["parent_reply_id"]
            isOneToOne: false
            referencedRelation: "safety_board_replies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_replies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "safety_board_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_replies_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "safety_board_trending"
            referencedColumns: ["thread_id"]
          },
        ]
      }
      safety_board_subscriptions: {
        Row: {
          created_at: string
          state: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          state?: string
          target_id: string
          target_type: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          state?: string
          target_id?: string
          target_type?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_thread_templates: {
        Row: {
          archived_at: string | null
          board_id: string
          created_at: string
          created_by: string
          default_body: string | null
          default_title: string | null
          description: string | null
          fields_schema: Json
          id: string
          kind: string
          name: string
          sort_order: number
          tenant_id: string
        }
        Insert: {
          archived_at?: string | null
          board_id: string
          created_at?: string
          created_by: string
          default_body?: string | null
          default_title?: string | null
          description?: string | null
          fields_schema?: Json
          id?: string
          kind: string
          name: string
          sort_order?: number
          tenant_id: string
        }
        Update: {
          archived_at?: string | null
          board_id?: string
          created_at?: string
          created_by?: string
          default_body?: string | null
          default_title?: string | null
          description?: string | null
          fields_schema?: Json
          id?: string
          kind?: string
          name?: string
          sort_order?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_thread_templates_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "safety_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_thread_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_threads: {
        Row: {
          acknowledgement_required: boolean
          author_user_id: string
          board_id: string
          body: string
          body_mentions: string[]
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          is_anonymous: boolean
          kind: string
          last_reply_at: string
          linked_entity_id: string | null
          linked_entity_type: string | null
          locked: boolean
          metadata: Json
          pinned: boolean
          search_tsv: unknown
          tenant_id: string
          title: string
        }
        Insert: {
          acknowledgement_required?: boolean
          author_user_id: string
          board_id: string
          body: string
          body_mentions?: string[]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_anonymous?: boolean
          kind?: string
          last_reply_at?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          locked?: boolean
          metadata?: Json
          pinned?: boolean
          search_tsv?: unknown
          tenant_id: string
          title: string
        }
        Update: {
          acknowledgement_required?: boolean
          author_user_id?: string
          board_id?: string
          body?: string
          body_mentions?: string[]
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          is_anonymous?: boolean
          kind?: string
          last_reply_at?: string
          linked_entity_id?: string | null
          linked_entity_type?: string | null
          locked?: boolean
          metadata?: Json
          pinned?: boolean
          search_tsv?: unknown
          tenant_id?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_threads_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "safety_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_boards: {
        Row: {
          allow_anonymous: boolean
          archived_at: string | null
          created_at: string
          created_by: string
          description: string | null
          facility_id: string | null
          id: string
          name: string
          slug: string
          tenant_id: string
        }
        Insert: {
          allow_anonymous?: boolean
          archived_at?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          facility_id?: string | null
          id?: string
          name: string
          slug: string
          tenant_id: string
        }
        Update: {
          allow_anonymous?: boolean
          archived_at?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          facility_id?: string | null
          id?: string
          name?: string
          slug?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_boards_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_boards_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_weather_readings: {
        Row: {
          created_at: string
          created_by: string | null
          facility_id: string | null
          forecast_fetched_at: string | null
          forecast_gust_mph: number | null
          forecast_wind_mph: number | null
          id: string
          instrument: string | null
          latitude: number | null
          longitude: number | null
          measured_gust_mph: number | null
          measured_wind_mph: number
          note: string | null
          reading_at: string
          tenant_id: string
          unit_system: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          forecast_fetched_at?: string | null
          forecast_gust_mph?: number | null
          forecast_wind_mph?: number | null
          id?: string
          instrument?: string | null
          latitude?: number | null
          longitude?: number | null
          measured_gust_mph?: number | null
          measured_wind_mph: number
          note?: string | null
          reading_at?: string
          tenant_id: string
          unit_system?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          forecast_fetched_at?: string | null
          forecast_gust_mph?: number | null
          forecast_wind_mph?: number | null
          id?: string
          instrument?: string | null
          latitude?: number | null
          longitude?: number | null
          measured_gust_mph?: number | null
          measured_wind_mph?: number
          note?: string | null
          reading_at?: string
          tenant_id?: string
          unit_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "safety_weather_readings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_weather_settings: {
        Row: {
          config: Json
          facility_id: string | null
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config?: Json
          facility_id?: string | null
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          facility_id?: string | null
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_weather_settings_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_weather_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_queries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: number
          name: string
          sql_text: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: number
          name: string
          sql_text: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: number
          name?: string
          sql_text?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_queries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_queries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      scim_tokens: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          id: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          scopes: string[]
          tenant_id: string
          token_hash: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id: string
          token_hash: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          id?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          scopes?: string[]
          tenant_id?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "scim_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sds_library_chemicals: {
        Row: {
          boiling_point_c: number | null
          canonical_name: string
          cas_numbers: string[]
          cas_primary: string | null
          created_at: string
          dot_hazard_class: string | null
          dot_packing_group: string | null
          dot_un_number: string | null
          firefighting: Json | null
          first_aid: Json | null
          flash_point_c: number | null
          ghs_pictograms: string[]
          ghs_signal_word: string | null
          hazard_statements: Json | null
          id: string
          idlh_ppm: number | null
          incompatibilities: string[]
          last_verified_at: string | null
          last_verified_fetch_hash: string | null
          last_verify_outcome: string | null
          manufacturer: string | null
          nfpa_flammability: number | null
          nfpa_health: number | null
          nfpa_instability: number | null
          nfpa_special: string | null
          notes: string | null
          parse_confidence: number | null
          parse_model: string | null
          parsed_payload: Json | null
          pel_twa_ppm: number | null
          physical_state: string | null
          ppe_required: string[]
          precautionary_statements: Json | null
          product_code: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          sds_revision_date: string | null
          seed_run_id: string | null
          source_host: string | null
          source_url: string | null
          spill_cleanup: Json | null
          stel_ppm: number | null
          storage_class: string | null
          synonyms: string[]
          updated_at: string
          vapor_pressure_kpa: number | null
        }
        Insert: {
          boiling_point_c?: number | null
          canonical_name: string
          cas_numbers?: string[]
          cas_primary?: string | null
          created_at?: string
          dot_hazard_class?: string | null
          dot_packing_group?: string | null
          dot_un_number?: string | null
          firefighting?: Json | null
          first_aid?: Json | null
          flash_point_c?: number | null
          ghs_pictograms?: string[]
          ghs_signal_word?: string | null
          hazard_statements?: Json | null
          id?: string
          idlh_ppm?: number | null
          incompatibilities?: string[]
          last_verified_at?: string | null
          last_verified_fetch_hash?: string | null
          last_verify_outcome?: string | null
          manufacturer?: string | null
          nfpa_flammability?: number | null
          nfpa_health?: number | null
          nfpa_instability?: number | null
          nfpa_special?: string | null
          notes?: string | null
          parse_confidence?: number | null
          parse_model?: string | null
          parsed_payload?: Json | null
          pel_twa_ppm?: number | null
          physical_state?: string | null
          ppe_required?: string[]
          precautionary_statements?: Json | null
          product_code?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sds_revision_date?: string | null
          seed_run_id?: string | null
          source_host?: string | null
          source_url?: string | null
          spill_cleanup?: Json | null
          stel_ppm?: number | null
          storage_class?: string | null
          synonyms?: string[]
          updated_at?: string
          vapor_pressure_kpa?: number | null
        }
        Update: {
          boiling_point_c?: number | null
          canonical_name?: string
          cas_numbers?: string[]
          cas_primary?: string | null
          created_at?: string
          dot_hazard_class?: string | null
          dot_packing_group?: string | null
          dot_un_number?: string | null
          firefighting?: Json | null
          first_aid?: Json | null
          flash_point_c?: number | null
          ghs_pictograms?: string[]
          ghs_signal_word?: string | null
          hazard_statements?: Json | null
          id?: string
          idlh_ppm?: number | null
          incompatibilities?: string[]
          last_verified_at?: string | null
          last_verified_fetch_hash?: string | null
          last_verify_outcome?: string | null
          manufacturer?: string | null
          nfpa_flammability?: number | null
          nfpa_health?: number | null
          nfpa_instability?: number | null
          nfpa_special?: string | null
          notes?: string | null
          parse_confidence?: number | null
          parse_model?: string | null
          parsed_payload?: Json | null
          pel_twa_ppm?: number | null
          physical_state?: string | null
          ppe_required?: string[]
          precautionary_statements?: Json | null
          product_code?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          sds_revision_date?: string | null
          seed_run_id?: string | null
          source_host?: string | null
          source_url?: string | null
          spill_cleanup?: Json | null
          stel_ppm?: number | null
          storage_class?: string | null
          synonyms?: string[]
          updated_at?: string
          vapor_pressure_kpa?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sds_library_chemicals_seed_run_id_fkey"
            columns: ["seed_run_id"]
            isOneToOne: false
            referencedRelation: "sds_library_seed_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sds_library_seed_items: {
        Row: {
          attempts: number
          chemical_id: string | null
          created_at: string
          id: string
          last_attempt_at: string | null
          last_error: string | null
          proposed_cas: string | null
          proposed_manufacturer: string | null
          proposed_name: string
          rationale: string | null
          seed_run_id: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          chemical_id?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          proposed_cas?: string | null
          proposed_manufacturer?: string | null
          proposed_name: string
          rationale?: string | null
          seed_run_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          chemical_id?: string | null
          created_at?: string
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          proposed_cas?: string | null
          proposed_manufacturer?: string | null
          proposed_name?: string
          rationale?: string | null
          seed_run_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sds_library_seed_items_chemical_id_fkey"
            columns: ["chemical_id"]
            isOneToOne: false
            referencedRelation: "sds_library_chemicals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sds_library_seed_items_seed_run_id_fkey"
            columns: ["seed_run_id"]
            isOneToOne: false
            referencedRelation: "sds_library_seed_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sds_library_seed_runs: {
        Row: {
          counts: Json
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          status: string
          target_count: number | null
          updated_at: string
        }
        Insert: {
          counts?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          target_count?: number | null
          updated_at?: string
        }
        Update: {
          counts?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          status?: string
          target_count?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      sds_library_sources: {
        Row: {
          chemical_id: string
          confidence: string | null
          created_at: string
          discovered_at: string
          host: string | null
          id: string
          is_primary: boolean
          last_checked_at: string | null
          last_fetch_hash: string | null
          last_fetch_outcome: string | null
          reasons: string | null
          revision_date: string | null
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          chemical_id: string
          confidence?: string | null
          created_at?: string
          discovered_at?: string
          host?: string | null
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          last_fetch_hash?: string | null
          last_fetch_outcome?: string | null
          reasons?: string | null
          revision_date?: string | null
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          chemical_id?: string
          confidence?: string | null
          created_at?: string
          discovered_at?: string
          host?: string | null
          id?: string
          is_primary?: boolean
          last_checked_at?: string | null
          last_fetch_hash?: string | null
          last_fetch_outcome?: string | null
          reasons?: string | null
          revision_date?: string | null
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "sds_library_sources_chemical_id_fkey"
            columns: ["chemical_id"]
            isOneToOne: false
            referencedRelation: "sds_library_chemicals"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          due_at: string | null
          expires_at: string | null
          id: string
          module_id: string
          module_version_id: string | null
          reason: string | null
          recurrence_rule: Json | null
          status: string
          target_id: string | null
          target_type: string
          tenant_id: string
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          due_at?: string | null
          expires_at?: string | null
          id?: string
          module_id: string
          module_version_id?: string | null
          reason?: string | null
          recurrence_rule?: Json | null
          status?: string
          target_id?: string | null
          target_type: string
          tenant_id: string
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          due_at?: string | null
          expires_at?: string | null
          id?: string
          module_id?: string
          module_version_id?: string | null
          reason?: string | null
          recurrence_rule?: Json | null
          status?: string
          target_id?: string | null
          target_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strike_assignments_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_assignments_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_attempts: {
        Row: {
          answers: Json
          assignment_id: string | null
          client_context: Json
          id: string
          member_id: string
          module_id: string
          module_version_id: string
          passed: boolean
          score_percent: number | null
          started_at: string
          submitted_at: string | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          answers?: Json
          assignment_id?: string | null
          client_context?: Json
          id?: string
          member_id: string
          module_id: string
          module_version_id: string
          passed?: boolean
          score_percent?: number | null
          started_at?: string
          submitted_at?: string | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          answers?: Json
          assignment_id?: string | null
          client_context?: Json
          id?: string
          member_id?: string
          module_id?: string
          module_version_id?: string
          passed?: boolean
          score_percent?: number | null
          started_at?: string
          submitted_at?: string | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strike_attempts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "strike_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_attempts_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "strike_attempts_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_attempts_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_completions: {
        Row: {
          assignment_id: string | null
          attempt_id: string | null
          completed_at: string
          evidence: Json
          expires_at: string | null
          id: string
          member_id: string
          module_id: string
          module_version_id: string
          passed: boolean
          score_percent: number | null
          source: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          assignment_id?: string | null
          attempt_id?: string | null
          completed_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          member_id: string
          module_id: string
          module_version_id: string
          passed?: boolean
          score_percent?: number | null
          source?: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          assignment_id?: string | null
          attempt_id?: string | null
          completed_at?: string
          evidence?: Json
          expires_at?: string | null
          id?: string
          member_id?: string
          module_id?: string
          module_version_id?: string
          passed?: boolean
          score_percent?: number | null
          source?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strike_completions_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "strike_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_completions_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "strike_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_completions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "strike_completions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_completions_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_completions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_media_access: {
        Row: {
          client_context: Json
          id: string
          issued_at: string
          media_kind: string
          module_id: string | null
          module_version_id: string | null
          object_ref: string
          provider: string
          tenant_id: string
          token_ttl_seconds: number
          user_id: string
        }
        Insert: {
          client_context?: Json
          id?: string
          issued_at?: string
          media_kind?: string
          module_id?: string | null
          module_version_id?: string | null
          object_ref: string
          provider: string
          tenant_id: string
          token_ttl_seconds: number
          user_id: string
        }
        Update: {
          client_context?: Json
          id?: string
          issued_at?: string
          media_kind?: string
          module_id?: string | null
          module_version_id?: string | null
          object_ref?: string
          provider?: string
          tenant_id?: string
          token_ttl_seconds?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strike_media_access_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_media_access_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_media_access_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_module_versions: {
        Row: {
          captions_path: string | null
          created_at: string
          created_by: string | null
          duration_seconds: number | null
          id: string
          library_scope: string
          module_id: string
          passing_score: number
          published_at: string | null
          reference_paths: Json
          retake_limit: number | null
          status: string
          tenant_id: string | null
          thumbnail_path: string | null
          transcript: string | null
          version_number: number
          video_external_id: string | null
          video_meta: Json
          video_path: string | null
          video_provider: string
          video_ready: boolean
        }
        Insert: {
          captions_path?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          id?: string
          library_scope: string
          module_id: string
          passing_score?: number
          published_at?: string | null
          reference_paths?: Json
          retake_limit?: number | null
          status?: string
          tenant_id?: string | null
          thumbnail_path?: string | null
          transcript?: string | null
          version_number: number
          video_external_id?: string | null
          video_meta?: Json
          video_path?: string | null
          video_provider?: string
          video_ready?: boolean
        }
        Update: {
          captions_path?: string | null
          created_at?: string
          created_by?: string | null
          duration_seconds?: number | null
          id?: string
          library_scope?: string
          module_id?: string
          passing_score?: number
          published_at?: string | null
          reference_paths?: Json
          retake_limit?: number | null
          status?: string
          tenant_id?: string | null
          thumbnail_path?: string | null
          transcript?: string | null
          version_number?: number
          video_external_id?: string | null
          video_meta?: Json
          video_path?: string | null
          video_provider?: string
          video_ready?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "strike_module_versions_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_module_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_modules: {
        Row: {
          archived_at: string | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          estimated_minutes: number | null
          id: string
          library_scope: string
          published_at: string | null
          slug: string
          status: string
          tags: string[]
          tenant_id: string | null
          thumbnail_path: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          library_scope: string
          published_at?: string | null
          slug: string
          status?: string
          tags?: string[]
          tenant_id?: string | null
          thumbnail_path?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          estimated_minutes?: number | null
          id?: string
          library_scope?: string
          published_at?: string | null
          slug?: string
          status?: string
          tags?: string[]
          tenant_id?: string | null
          thumbnail_path?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strike_modules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_quiz_answers: {
        Row: {
          answer_text: string
          created_at: string
          id: string
          is_correct: boolean
          library_scope: string
          question_id: string
          sort_order: number
          tenant_id: string | null
        }
        Insert: {
          answer_text: string
          created_at?: string
          id?: string
          is_correct?: boolean
          library_scope: string
          question_id: string
          sort_order?: number
          tenant_id?: string | null
        }
        Update: {
          answer_text?: string
          created_at?: string
          id?: string
          is_correct?: boolean
          library_scope?: string
          question_id?: string
          sort_order?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strike_quiz_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "strike_quiz_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_quiz_answers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_quiz_questions: {
        Row: {
          created_at: string
          explanation: string | null
          id: string
          library_scope: string
          module_version_id: string
          points: number
          prompt: string
          question_type: string
          required: boolean
          sort_order: number
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          explanation?: string | null
          id?: string
          library_scope: string
          module_version_id: string
          points?: number
          prompt: string
          question_type: string
          required?: boolean
          sort_order?: number
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          explanation?: string | null
          id?: string
          library_scope?: string
          module_version_id?: string
          points?: number
          prompt?: string
          question_type?: string
          required?: boolean
          sort_order?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strike_quiz_questions_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_quiz_questions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_studio_requests: {
        Row: {
          created_at: string
          desired_due_date: string | null
          id: string
          internal_notes: string | null
          priority: string
          request_type: string
          requested_by: string | null
          site_location: string | null
          source_documents: Json
          status: string
          target_audience: string | null
          task_description: string | null
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          desired_due_date?: string | null
          id?: string
          internal_notes?: string | null
          priority?: string
          request_type?: string
          requested_by?: string | null
          site_location?: string | null
          source_documents?: Json
          status?: string
          target_audience?: string | null
          task_description?: string | null
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          desired_due_date?: string | null
          id?: string
          internal_notes?: string | null
          priority?: string
          request_type?: string
          requested_by?: string | null
          site_location?: string | null
          source_documents?: Json
          status?: string
          target_audience?: string | null
          task_description?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "strike_studio_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_task_checks: {
        Row: {
          checked_at: string
          checked_by: string | null
          completion_id: string | null
          id: string
          member_id: string | null
          module_id: string | null
          module_version_id: string | null
          notes: string | null
          readiness_status: string
          required_count: number
          requirement_id: string | null
          source_id: string | null
          source_type: string
          tenant_id: string
          user_id: string | null
          valid_completion_count: number
        }
        Insert: {
          checked_at?: string
          checked_by?: string | null
          completion_id?: string | null
          id?: string
          member_id?: string | null
          module_id?: string | null
          module_version_id?: string | null
          notes?: string | null
          readiness_status: string
          required_count?: number
          requirement_id?: string | null
          source_id?: string | null
          source_type: string
          tenant_id: string
          user_id?: string | null
          valid_completion_count?: number
        }
        Update: {
          checked_at?: string
          checked_by?: string | null
          completion_id?: string | null
          id?: string
          member_id?: string | null
          module_id?: string | null
          module_version_id?: string | null
          notes?: string | null
          readiness_status?: string
          required_count?: number
          requirement_id?: string | null
          source_id?: string | null
          source_type?: string
          tenant_id?: string
          user_id?: string | null
          valid_completion_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "strike_task_checks_completion_id_fkey"
            columns: ["completion_id"]
            isOneToOne: false
            referencedRelation: "strike_completions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_task_checks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_task_checks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_task_checks_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "strike_task_checks_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_task_checks_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_task_checks_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "strike_training_requirements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_task_checks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_tenant_settings: {
        Row: {
          default_passing_score: number
          leaderboard_enabled: boolean
          require_quiz_pass_for_credit: boolean
          require_watch_percent: number | null
          team_leaderboard_enabled: boolean
          tenant_authoring_enabled: boolean
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_passing_score?: number
          leaderboard_enabled?: boolean
          require_quiz_pass_for_credit?: boolean
          require_watch_percent?: number | null
          team_leaderboard_enabled?: boolean
          tenant_authoring_enabled?: boolean
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_passing_score?: number
          leaderboard_enabled?: boolean
          require_quiz_pass_for_credit?: boolean
          require_watch_percent?: number | null
          team_leaderboard_enabled?: boolean
          tenant_authoring_enabled?: boolean
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "strike_tenant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      strike_training_requirements: {
        Row: {
          active: boolean
          created_at: string
          created_by: string | null
          expires_after_days: number | null
          hazard_category: string | null
          id: string
          module_id: string
          module_version_id: string | null
          notes: string | null
          required_before_start: boolean
          source_id: string | null
          source_type: string
          tenant_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          expires_after_days?: number | null
          hazard_category?: string | null
          id?: string
          module_id: string
          module_version_id?: string | null
          notes?: string | null
          required_before_start?: boolean
          source_id?: string | null
          source_type: string
          tenant_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string | null
          expires_after_days?: number | null
          hazard_category?: string | null
          id?: string
          module_id?: string
          module_version_id?: string | null
          notes?: string | null
          required_before_start?: boolean
          source_id?: string | null
          source_type?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "strike_training_requirements_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "strike_modules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_training_requirements_module_version_id_fkey"
            columns: ["module_version_id"]
            isOneToOne: false
            referencedRelation: "strike_module_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "strike_training_requirements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      superadmin_daily_reports: {
        Row: {
          anomalies: string[]
          delivered_at: string | null
          for_date: string
          generated_at: string
          id: number
          metrics: Json
          model: string
          narrative: string
        }
        Insert: {
          anomalies?: string[]
          delivered_at?: string | null
          for_date: string
          generated_at?: string
          id?: number
          metrics: Json
          model: string
          narrative: string
        }
        Update: {
          anomalies?: string[]
          delivered_at?: string | null
          for_date?: string
          generated_at?: string
          id?: number
          metrics?: Json
          model?: string
          narrative?: string
        }
        Relationships: []
      }
      support_conversations: {
        Row: {
          id: string
          language: string | null
          last_message_at: string
          origin_path: string | null
          resolved: boolean
          started_at: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          id?: string
          language?: string | null
          last_message_at?: string
          origin_path?: string | null
          resolved?: boolean
          started_at?: string
          tenant_id?: string
          user_id: string
        }
        Update: {
          id?: string
          language?: string | null
          last_message_at?: string
          origin_path?: string | null
          resolved?: boolean
          started_at?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_conversations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          cache_read_tokens: number | null
          content: string
          conversation_id: string
          created_at: string
          helpful: boolean | null
          helpful_at: string | null
          id: string
          input_tokens: number | null
          output_tokens: number | null
          role: string
        }
        Insert: {
          cache_read_tokens?: number | null
          content: string
          conversation_id: string
          created_at?: string
          helpful?: boolean | null
          helpful_at?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role: string
        }
        Update: {
          cache_read_tokens?: number | null
          content?: string
          conversation_id?: string
          created_at?: string
          helpful?: boolean | null
          helpful_at?: string | null
          id?: string
          input_tokens?: number | null
          output_tokens?: number | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          archived_at: string | null
          conversation_id: string
          created_at: string
          emailed_ok: boolean | null
          id: string
          reason: string
          resolved_at: string | null
          subject: string
          summary: string
          tenant_id: string
          user_email: string | null
          user_id: string
          user_name: string | null
        }
        Insert: {
          archived_at?: string | null
          conversation_id: string
          created_at?: string
          emailed_ok?: boolean | null
          id?: string
          reason: string
          resolved_at?: string | null
          subject: string
          summary: string
          tenant_id?: string
          user_email?: string | null
          user_id: string
          user_name?: string | null
        }
        Update: {
          archived_at?: string | null
          conversation_id?: string
          created_at?: string
          emailed_ok?: boolean | null
          id?: string
          reason?: string
          resolved_at?: string | null
          subject?: string
          summary?: string
          tenant_id?: string
          user_email?: string | null
          user_id?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "support_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_memberships: {
        Row: {
          created_at: string
          invite_cancelled_at: string | null
          invite_cancelled_reason: string | null
          invite_last_reminder_at: string | null
          invite_reminders_sent: number
          invited_by: string | null
          role: string
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invite_cancelled_at?: string | null
          invite_cancelled_reason?: string | null
          invite_last_reminder_at?: string | null
          invite_reminders_sent?: number
          invited_by?: string | null
          role?: string
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          invite_cancelled_at?: string | null
          invite_cancelled_reason?: string | null
          invite_last_reminder_at?: string | null
          invite_reminders_sent?: number
          invited_by?: string | null
          role?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_memberships_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_retention_policies: {
        Row: {
          incident_retention_days: number
          loto_artifact_retention_years: number
          permit_retention_days: number
          tenant_id: string
          training_retention_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          incident_retention_days?: number
          loto_artifact_retention_years?: number
          permit_retention_days?: number
          tenant_id: string
          training_retention_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          incident_retention_days?: number
          loto_artifact_retention_years?: number
          permit_retention_days?: number
          tenant_id?: string
          training_retention_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_retention_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_secrets: {
        Row: {
          ciphertext: string
          created_at: string
          created_by: string | null
          kind: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          ciphertext: string
          created_at?: string
          created_by?: string | null
          kind: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          ciphertext?: string
          created_at?: string
          created_by?: string | null
          kind?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_secrets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_sso_configurations: {
        Row: {
          created_at: string
          created_by_user_id: string | null
          enabled: boolean
          idp_metadata_url: string | null
          idp_metadata_xml: string | null
          provider: string
          sp_acs_url: string
          sp_entity_id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by_user_id?: string | null
          enabled?: boolean
          idp_metadata_url?: string | null
          idp_metadata_xml?: string | null
          provider: string
          sp_acs_url: string
          sp_entity_id: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by_user_id?: string | null
          enabled?: boolean
          idp_metadata_url?: string | null
          idp_metadata_xml?: string | null
          provider?: string
          sp_acs_url?: string
          sp_entity_id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sso_configurations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          custom_domain: string | null
          default_report_locale: string
          disabled_at: string | null
          id: string
          industry_profile: string
          is_demo: boolean
          language: string
          logo_url: string | null
          modules: Json
          name: string
          retaliation_statement_override: string | null
          settings: Json
          slug: string
          status: string
          tenant_number: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_domain?: string | null
          default_report_locale?: string
          disabled_at?: string | null
          id?: string
          industry_profile?: string
          is_demo?: boolean
          language?: string
          logo_url?: string | null
          modules?: Json
          name: string
          retaliation_statement_override?: string | null
          settings?: Json
          slug: string
          status?: string
          tenant_number: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_domain?: string | null
          default_report_locale?: string
          disabled_at?: string | null
          id?: string
          industry_profile?: string
          is_demo?: boolean
          language?: string
          logo_url?: string | null
          modules?: Json
          name?: string
          retaliation_statement_override?: string | null
          settings?: Json
          slug?: string
          status?: string
          tenant_number?: string
          updated_at?: string
        }
        Relationships: []
      }
      toolbox_talk_signatures: {
        Row: {
          employee_id: string | null
          id: string
          inserted_by: string | null
          signature_data: string
          signed_at: string
          signed_ip: string | null
          signer_name: string
          signer_user_id: string | null
          talk_id: string
          tenant_id: string
        }
        Insert: {
          employee_id?: string | null
          id?: string
          inserted_by?: string | null
          signature_data: string
          signed_at?: string
          signed_ip?: string | null
          signer_name: string
          signer_user_id?: string | null
          talk_id: string
          tenant_id: string
        }
        Update: {
          employee_id?: string | null
          id?: string
          inserted_by?: string | null
          signature_data?: string
          signed_at?: string
          signed_ip?: string | null
          signer_name?: string
          signer_user_id?: string | null
          talk_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_talk_signatures_talk_id_fkey"
            columns: ["talk_id"]
            isOneToOne: false
            referencedRelation: "toolbox_talks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talk_signatures_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_talks: {
        Row: {
          ai_model: string | null
          body_markdown: string
          body_markdown_es: string | null
          created_at: string
          delivery_notes: string | null
          delivery_notes_es: string | null
          facility_id: string | null
          generated_at: string
          generated_by: string | null
          id: string
          key_points: string[]
          key_points_es: string[]
          talk_date: string
          tenant_id: string
          title: string
          title_es: string | null
          topic_id: string
        }
        Insert: {
          ai_model?: string | null
          body_markdown: string
          body_markdown_es?: string | null
          created_at?: string
          delivery_notes?: string | null
          delivery_notes_es?: string | null
          facility_id?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          key_points?: string[]
          key_points_es?: string[]
          talk_date: string
          tenant_id: string
          title: string
          title_es?: string | null
          topic_id: string
        }
        Update: {
          ai_model?: string | null
          body_markdown?: string
          body_markdown_es?: string | null
          created_at?: string
          delivery_notes?: string | null
          delivery_notes_es?: string | null
          facility_id?: string | null
          generated_at?: string
          generated_by?: string | null
          id?: string
          key_points?: string[]
          key_points_es?: string[]
          talk_date?: string
          tenant_id?: string
          title?: string
          title_es?: string | null
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toolbox_talks_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toolbox_talks_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "toolbox_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      toolbox_topics: {
        Row: {
          active: boolean
          created_at: string
          id: string
          industry: string
          reference: string | null
          source_key: string | null
          summary: string
          title: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          industry?: string
          reference?: string | null
          source_key?: string | null
          summary: string
          title: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          industry?: string
          reference?: string | null
          source_key?: string | null
          summary?: string
          title?: string
        }
        Relationships: []
      }
      training_courses: {
        Row: {
          active: boolean
          category: string | null
          code: string
          competency_exam_id: string | null
          created_at: string
          created_by: string | null
          id: string
          required_for_all: boolean
          role: string | null
          tenant_id: string
          title: string
          updated_at: string
          validity_months: number | null
        }
        Insert: {
          active?: boolean
          category?: string | null
          code: string
          competency_exam_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          required_for_all?: boolean
          role?: string | null
          tenant_id: string
          title: string
          updated_at?: string
          validity_months?: number | null
        }
        Update: {
          active?: boolean
          category?: string | null
          code?: string
          competency_exam_id?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          required_for_all?: boolean
          role?: string | null
          tenant_id?: string
          title?: string
          updated_at?: string
          validity_months?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "training_courses_competency_exam_id_fkey"
            columns: ["competency_exam_id"]
            isOneToOne: false
            referencedRelation: "loto_competency_exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_courses_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "training_courses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_digest_preferences: {
        Row: {
          cadence: string
          created_at: string
          email: string
          last_sent_at: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cadence?: string
          created_at?: string
          email: string
          last_sent_at?: string | null
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cadence?: string
          created_at?: string
          email?: string
          last_sent_at?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_digest_preferences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_prequalifications: {
        Row: {
          approval_expires_at: string | null
          contractor_company_id: string
          created_at: string
          facility_id: string | null
          id: string
          portal_token: string | null
          q1_safety_management: string | null
          q2_emr: string | null
          q3_dart: string | null
          q4_trir: string | null
          q5_iso_certs: string | null
          q6_drug_alcohol_program: boolean
          q7_insurance_limits: string | null
          q8_references: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by_user_id: string | null
          status: string
          submitted_at: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          approval_expires_at?: string | null
          contractor_company_id: string
          created_at?: string
          facility_id?: string | null
          id?: string
          portal_token?: string | null
          q1_safety_management?: string | null
          q2_emr?: string | null
          q3_dart?: string | null
          q4_trir?: string | null
          q5_iso_certs?: string | null
          q6_drug_alcohol_program?: boolean
          q7_insurance_limits?: string | null
          q8_references?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          approval_expires_at?: string | null
          contractor_company_id?: string
          created_at?: string
          facility_id?: string | null
          id?: string
          portal_token?: string | null
          q1_safety_management?: string | null
          q2_emr?: string | null
          q3_dart?: string | null
          q4_trir?: string | null
          q5_iso_certs?: string | null
          q6_drug_alcohol_program?: boolean
          q7_insurance_limits?: string | null
          q8_references?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by_user_id?: string | null
          status?: string
          submitted_at?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_prequalifications_contractor_company_id_fkey"
            columns: ["contractor_company_id"]
            isOneToOne: false
            referencedRelation: "loto_contractor_companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_prequalifications_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_prequalifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_anchors: {
        Row: {
          asset_tag: string | null
          created_at: string
          created_by: string | null
          drawing_ref: string | null
          facility_id: string | null
          id: string
          installation_date: string | null
          kind: Database["public"]["Enums"]["wah_anchor_kind"]
          last_inspected_at: string | null
          last_inspector_id: string | null
          location_label: string
          notes: string | null
          qp_certified_at: string | null
          qp_name: string | null
          qp_pe_license: string | null
          rated_capacity_lbf: number
          recertification_due_at: string | null
          status: Database["public"]["Enums"]["wah_equipment_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
          workers_max: number
        }
        Insert: {
          asset_tag?: string | null
          created_at?: string
          created_by?: string | null
          drawing_ref?: string | null
          facility_id?: string | null
          id?: string
          installation_date?: string | null
          kind: Database["public"]["Enums"]["wah_anchor_kind"]
          last_inspected_at?: string | null
          last_inspector_id?: string | null
          location_label: string
          notes?: string | null
          qp_certified_at?: string | null
          qp_name?: string | null
          qp_pe_license?: string | null
          rated_capacity_lbf: number
          recertification_due_at?: string | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          workers_max?: number
        }
        Update: {
          asset_tag?: string | null
          created_at?: string
          created_by?: string | null
          drawing_ref?: string | null
          facility_id?: string | null
          id?: string
          installation_date?: string | null
          kind?: Database["public"]["Enums"]["wah_anchor_kind"]
          last_inspected_at?: string | null
          last_inspector_id?: string | null
          location_label?: string
          notes?: string | null
          qp_certified_at?: string | null
          qp_name?: string | null
          qp_pe_license?: string | null
          rated_capacity_lbf?: number
          recertification_due_at?: string | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          workers_max?: number
        }
        Relationships: [
          {
            foreignKeyName: "wah_anchors_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_anchors_last_inspector_id_fkey"
            columns: ["last_inspector_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_anchors_last_inspector_id_fkey"
            columns: ["last_inspector_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_anchors_last_inspector_id_fkey"
            columns: ["last_inspector_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_anchors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_authorizations: {
        Row: {
          certificate_url: string | null
          created_at: string
          created_by: string | null
          id: string
          member_id: string
          notes: string | null
          qp_pe_license: string | null
          role: Database["public"]["Enums"]["wah_role"]
          scope: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
          valid_from: string
          valid_until: string
        }
        Insert: {
          certificate_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          member_id: string
          notes?: string | null
          qp_pe_license?: string | null
          role: Database["public"]["Enums"]["wah_role"]
          scope?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
          valid_from: string
          valid_until: string
        }
        Update: {
          certificate_url?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          member_id?: string
          notes?: string | null
          qp_pe_license?: string | null
          role?: Database["public"]["Enums"]["wah_role"]
          scope?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
          valid_from?: string
          valid_until?: string
        }
        Relationships: [
          {
            foreignKeyName: "wah_authorizations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_authorizations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_authorizations_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_authorizations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_components: {
        Row: {
          assigned_to_member_id: string | null
          created_at: string
          created_by: string | null
          first_used_date: string | null
          id: string
          last_periodic_inspection_at: string | null
          last_periodic_inspector_id: string | null
          last_pre_use_inspection_at: string | null
          manufacturer: string
          metadata: Json
          mfg_date: string | null
          model: string | null
          notes: string | null
          serial: string
          service_expires_at: string | null
          service_life_years: number | null
          status: Database["public"]["Enums"]["wah_equipment_status"]
          status_photo_url: string | null
          status_reason: string | null
          storage_location: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["wah_component_type"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          assigned_to_member_id?: string | null
          created_at?: string
          created_by?: string | null
          first_used_date?: string | null
          id?: string
          last_periodic_inspection_at?: string | null
          last_periodic_inspector_id?: string | null
          last_pre_use_inspection_at?: string | null
          manufacturer: string
          metadata?: Json
          mfg_date?: string | null
          model?: string | null
          notes?: string | null
          serial: string
          service_expires_at?: string | null
          service_life_years?: number | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          status_photo_url?: string | null
          status_reason?: string | null
          storage_location?: string | null
          tenant_id: string
          type: Database["public"]["Enums"]["wah_component_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          assigned_to_member_id?: string | null
          created_at?: string
          created_by?: string | null
          first_used_date?: string | null
          id?: string
          last_periodic_inspection_at?: string | null
          last_periodic_inspector_id?: string | null
          last_pre_use_inspection_at?: string | null
          manufacturer?: string
          metadata?: Json
          mfg_date?: string | null
          model?: string | null
          notes?: string | null
          serial?: string
          service_expires_at?: string | null
          service_life_years?: number | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          status_photo_url?: string | null
          status_reason?: string | null
          storage_location?: string | null
          tenant_id?: string
          type?: Database["public"]["Enums"]["wah_component_type"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wah_components_assigned_to_member_id_fkey"
            columns: ["assigned_to_member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_components_assigned_to_member_id_fkey"
            columns: ["assigned_to_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_components_assigned_to_member_id_fkey"
            columns: ["assigned_to_member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_components_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_components_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_components_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_components_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_inspections: {
        Row: {
          anchor_id: string | null
          component_id: string | null
          created_at: string
          created_by: string | null
          facility_id: string | null
          findings: Json
          id: string
          inspector_id: string
          kind: Database["public"]["Enums"]["wah_inspection_kind"]
          ladder_fixed_id: string | null
          ladder_portable_id: string | null
          notes: string | null
          outcome: Database["public"]["Enums"]["wah_inspection_outcome"]
          performed_at: string
          photo_urls: string[]
          tenant_id: string
        }
        Insert: {
          anchor_id?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          findings?: Json
          id?: string
          inspector_id: string
          kind: Database["public"]["Enums"]["wah_inspection_kind"]
          ladder_fixed_id?: string | null
          ladder_portable_id?: string | null
          notes?: string | null
          outcome: Database["public"]["Enums"]["wah_inspection_outcome"]
          performed_at?: string
          photo_urls?: string[]
          tenant_id: string
        }
        Update: {
          anchor_id?: string | null
          component_id?: string | null
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          findings?: Json
          id?: string
          inspector_id?: string
          kind?: Database["public"]["Enums"]["wah_inspection_kind"]
          ladder_fixed_id?: string | null
          ladder_portable_id?: string | null
          notes?: string | null
          outcome?: Database["public"]["Enums"]["wah_inspection_outcome"]
          performed_at?: string
          photo_urls?: string[]
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wah_inspections_anchor_id_fkey"
            columns: ["anchor_id"]
            isOneToOne: false
            referencedRelation: "wah_anchors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "wah_components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_inspector_id_fkey"
            columns: ["inspector_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_inspections_ladder_fixed_id_fkey"
            columns: ["ladder_fixed_id"]
            isOneToOne: false
            referencedRelation: "wah_ladders_fixed"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_ladder_portable_id_fkey"
            columns: ["ladder_portable_id"]
            isOneToOne: false
            referencedRelation: "wah_ladders_portable"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_inspections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_ladders_fixed: {
        Row: {
          asset_tag: string | null
          created_at: string
          created_by: string | null
          drawing_ref: string | null
          facility_id: string | null
          has_cage: boolean
          has_ladder_safety_system: boolean
          height_ft: number
          id: string
          ladder_safety_system_serial: string | null
          last_periodic_inspection_at: string | null
          last_periodic_inspector_id: string | null
          location_label: string
          notes: string | null
          retrofit_target_date: string | null
          status: Database["public"]["Enums"]["wah_equipment_status"]
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_tag?: string | null
          created_at?: string
          created_by?: string | null
          drawing_ref?: string | null
          facility_id?: string | null
          has_cage?: boolean
          has_ladder_safety_system?: boolean
          height_ft: number
          id?: string
          ladder_safety_system_serial?: string | null
          last_periodic_inspection_at?: string | null
          last_periodic_inspector_id?: string | null
          location_label: string
          notes?: string | null
          retrofit_target_date?: string | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_tag?: string | null
          created_at?: string
          created_by?: string | null
          drawing_ref?: string | null
          facility_id?: string | null
          has_cage?: boolean
          has_ladder_safety_system?: boolean
          height_ft?: number
          id?: string
          ladder_safety_system_serial?: string | null
          last_periodic_inspection_at?: string | null
          last_periodic_inspector_id?: string | null
          location_label?: string
          notes?: string | null
          retrofit_target_date?: string | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wah_ladders_fixed_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_ladders_fixed_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_ladders_fixed_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_ladders_fixed_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_ladders_fixed_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_ladders_portable: {
        Row: {
          asset_tag: string | null
          created_at: string
          created_by: string | null
          duty_rating: Database["public"]["Enums"]["wah_ladder_duty"]
          facility_id: string | null
          height_ft: number | null
          id: string
          ladder_type: Database["public"]["Enums"]["wah_ladder_type"]
          last_periodic_inspection_at: string | null
          last_periodic_inspector_id: string | null
          last_pre_use_inspection_at: string | null
          manufacturer: string | null
          material: Database["public"]["Enums"]["wah_ladder_material"]
          max_capacity_lbf: number | null
          model: string | null
          notes: string | null
          purchase_date: string | null
          serial: string | null
          status: Database["public"]["Enums"]["wah_equipment_status"]
          status_reason: string | null
          storage_location: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          asset_tag?: string | null
          created_at?: string
          created_by?: string | null
          duty_rating: Database["public"]["Enums"]["wah_ladder_duty"]
          facility_id?: string | null
          height_ft?: number | null
          id?: string
          ladder_type: Database["public"]["Enums"]["wah_ladder_type"]
          last_periodic_inspection_at?: string | null
          last_periodic_inspector_id?: string | null
          last_pre_use_inspection_at?: string | null
          manufacturer?: string | null
          material: Database["public"]["Enums"]["wah_ladder_material"]
          max_capacity_lbf?: number | null
          model?: string | null
          notes?: string | null
          purchase_date?: string | null
          serial?: string | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          status_reason?: string | null
          storage_location?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          asset_tag?: string | null
          created_at?: string
          created_by?: string | null
          duty_rating?: Database["public"]["Enums"]["wah_ladder_duty"]
          facility_id?: string | null
          height_ft?: number | null
          id?: string
          ladder_type?: Database["public"]["Enums"]["wah_ladder_type"]
          last_periodic_inspection_at?: string | null
          last_periodic_inspector_id?: string | null
          last_pre_use_inspection_at?: string | null
          manufacturer?: string | null
          material?: Database["public"]["Enums"]["wah_ladder_material"]
          max_capacity_lbf?: number | null
          model?: string | null
          notes?: string | null
          purchase_date?: string | null
          serial?: string | null
          status?: Database["public"]["Enums"]["wah_equipment_status"]
          status_reason?: string | null
          storage_location?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wah_ladders_portable_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_ladders_portable_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_ladders_portable_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_ladders_portable_last_periodic_inspector_id_fkey"
            columns: ["last_periodic_inspector_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_ladders_portable_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      wah_permits: {
        Row: {
          anchor_id: string | null
          clearance_calculation: Json | null
          closed_at: string | null
          closed_by: string | null
          components_used: string[]
          cp_id: string
          created_at: string
          created_by: string | null
          facility_id: string | null
          id: string
          jha_id: string | null
          notes: string | null
          permit_number: string
          rescue_plan_id: string | null
          status: Database["public"]["Enums"]["wah_permit_status"]
          task_description: string | null
          tenant_id: string
          valid_from: string
          valid_until: string
          weather_check: Json | null
          work_location: string
          worker_id: string
        }
        Insert: {
          anchor_id?: string | null
          clearance_calculation?: Json | null
          closed_at?: string | null
          closed_by?: string | null
          components_used?: string[]
          cp_id: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          jha_id?: string | null
          notes?: string | null
          permit_number: string
          rescue_plan_id?: string | null
          status?: Database["public"]["Enums"]["wah_permit_status"]
          task_description?: string | null
          tenant_id: string
          valid_from: string
          valid_until: string
          weather_check?: Json | null
          work_location: string
          worker_id: string
        }
        Update: {
          anchor_id?: string | null
          clearance_calculation?: Json | null
          closed_at?: string | null
          closed_by?: string | null
          components_used?: string[]
          cp_id?: string
          created_at?: string
          created_by?: string | null
          facility_id?: string | null
          id?: string
          jha_id?: string | null
          notes?: string | null
          permit_number?: string
          rescue_plan_id?: string | null
          status?: Database["public"]["Enums"]["wah_permit_status"]
          task_description?: string | null
          tenant_id?: string
          valid_from?: string
          valid_until?: string
          weather_check?: Json | null
          work_location?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wah_permits_anchor_id_fkey"
            columns: ["anchor_id"]
            isOneToOne: false
            referencedRelation: "wah_anchors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_cp_id_fkey"
            columns: ["cp_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_cp_id_fkey"
            columns: ["cp_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_cp_id_fkey"
            columns: ["cp_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_permits_facility_id_fkey"
            columns: ["facility_id"]
            isOneToOne: false
            referencedRelation: "facilities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_rescue_plan_id_fkey"
            columns: ["rescue_plan_id"]
            isOneToOne: false
            referencedRelation: "wah_rescue_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_permits_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
        ]
      }
      wah_rescue_plans: {
        Row: {
          backup_rescuer_id: string | null
          contact_911_protocol: string | null
          created_at: string
          created_by: string | null
          equipment_cache: Json
          evacuation_route_photo_url: string | null
          id: string
          last_drilled_at: string | null
          location_label: string
          next_drill_due: string | null
          notes: string | null
          primary_rescuer_id: string | null
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          backup_rescuer_id?: string | null
          contact_911_protocol?: string | null
          created_at?: string
          created_by?: string | null
          equipment_cache?: Json
          evacuation_route_photo_url?: string | null
          id?: string
          last_drilled_at?: string | null
          location_label: string
          next_drill_due?: string | null
          notes?: string | null
          primary_rescuer_id?: string | null
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          backup_rescuer_id?: string | null
          contact_911_protocol?: string | null
          created_at?: string
          created_by?: string | null
          equipment_cache?: Json
          evacuation_route_photo_url?: string | null
          id?: string
          last_drilled_at?: string | null
          location_label?: string
          next_drill_due?: string | null
          notes?: string | null
          primary_rescuer_id?: string | null
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wah_rescue_plans_backup_rescuer_id_fkey"
            columns: ["backup_rescuer_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_rescue_plans_backup_rescuer_id_fkey"
            columns: ["backup_rescuer_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_rescue_plans_backup_rescuer_id_fkey"
            columns: ["backup_rescuer_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_rescue_plans_primary_rescuer_id_fkey"
            columns: ["primary_rescuer_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_rescue_plans_primary_rescuer_id_fkey"
            columns: ["primary_rescuer_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wah_rescue_plans_primary_rescuer_id_fkey"
            columns: ["primary_rescuer_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "wah_rescue_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      waitlist_signups: {
        Row: {
          company: string | null
          created_at: string
          email: string
          id: string
          ip_hash: string | null
          name: string | null
          source: string | null
          utm: Json | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email: string
          id?: string
          ip_hash?: string | null
          name?: string | null
          source?: string | null
          utm?: Json | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string
          id?: string
          ip_hash?: string | null
          name?: string | null
          source?: string | null
          utm?: Json | null
        }
        Relationships: []
      }
      worker_position_assignments: {
        Row: {
          created_at: string
          id: string
          is_current: boolean
          member_id: string
          notes: string | null
          position_id: string | null
          service_start_date: string | null
          shift_label: string | null
          supervisor_user_id: string | null
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_current?: boolean
          member_id: string
          notes?: string | null
          position_id?: string | null
          service_start_date?: string | null
          shift_label?: string | null
          supervisor_user_id?: string | null
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_current?: boolean
          member_id?: string
          notes?: string | null
          position_id?: string | null
          service_start_date?: string | null
          shift_label?: string | null
          supervisor_user_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_position_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_position_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_position_assignments_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "worker_position_assignments_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "worker_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_position_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_positions: {
        Row: {
          active: boolean
          created_at: string
          department: string | null
          description: string | null
          id: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          department?: string | null
          description?: string | null
          id?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_positions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      bbs_leaderboard: {
        Row: {
          avatar_url: string | null
          full_name: string | null
          last_submitted_at: string | null
          observation_count: number | null
          points_total: number | null
          safe_behavior_count: number | null
          tenant_id: string | null
          unsafe_act_count: number | null
          unsafe_condition_count: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bbs_observations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      incident_people_safe: {
        Row: {
          body_part: string[] | null
          created_at: string | null
          date_of_birth: string | null
          email: string | null
          employment_type: string | null
          full_name: string | null
          gender: string | null
          hire_date: string | null
          home_address: string | null
          id: string | null
          incident_id: string | null
          injury_nature: string | null
          injury_source: string | null
          is_primary: boolean | null
          job_title: string | null
          person_role: string | null
          phone: string | null
          tenant_id: string | null
          treatment_facility: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          body_part?: string[] | null
          created_at?: string | null
          date_of_birth?: never
          email?: string | null
          employment_type?: string | null
          full_name?: string | null
          gender?: never
          hire_date?: string | null
          home_address?: never
          id?: string | null
          incident_id?: string | null
          injury_nature?: string | null
          injury_source?: string | null
          is_primary?: boolean | null
          job_title?: string | null
          person_role?: string | null
          phone?: string | null
          tenant_id?: string | null
          treatment_facility?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          body_part?: string[] | null
          created_at?: string | null
          date_of_birth?: never
          email?: string | null
          employment_type?: string | null
          full_name?: string | null
          gender?: never
          hire_date?: string | null
          home_address?: never
          id?: string | null
          incident_id?: string | null
          injury_nature?: string | null
          injury_source?: string | null
          is_primary?: boolean | null
          job_title?: string | null
          person_role?: string | null
          phone?: string | null
          tenant_id?: string | null
          treatment_facility?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "incident_people_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "incidents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incident_people_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_worker_retraining_status: {
        Row: {
          active: boolean | null
          employee_id: string | null
          full_name: string | null
          last_trained_at: string | null
          open_trigger_count: number | null
          tenant_id: string | null
          worker_id: string | null
        }
        Insert: {
          active?: boolean | null
          employee_id?: string | null
          full_name?: string | null
          last_trained_at?: never
          open_trigger_count?: never
          tenant_id?: string | null
          worker_id?: string | null
        }
        Update: {
          active?: boolean | null
          employee_id?: string | null
          full_name?: string | null
          last_trained_at?: never
          open_trigger_count?: never
          tenant_id?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loto_workers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      loto_workers_v: {
        Row: {
          active: boolean | null
          created_at: string | null
          created_by: string | null
          email: string | null
          employee_id: string | null
          full_name: string | null
          id: string | null
          notes: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          active?: never
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: never
          id?: string | null
          notes?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: never
          created_at?: string | null
          created_by?: string | null
          email?: string | null
          employee_id?: string | null
          full_name?: never
          id?: string | null
          notes?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      osha_establishments_admin: {
        Row: {
          certifying_executive_name: string | null
          certifying_executive_title: string | null
          city: string | null
          created_at: string | null
          created_by: string | null
          establishment_name: string | null
          hours_employees_by_year: Json | null
          id: string | null
          is_partial_year: boolean | null
          ita_api_token: string | null
          ita_establishment_id: string | null
          naics_code: string | null
          state: string | null
          street: string | null
          tenant_id: string | null
          updated_at: string | null
          updated_by: string | null
          zip: string | null
        }
        Insert: {
          certifying_executive_name?: string | null
          certifying_executive_title?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          establishment_name?: string | null
          hours_employees_by_year?: Json | null
          id?: string | null
          is_partial_year?: boolean | null
          ita_api_token?: string | null
          ita_establishment_id?: string | null
          naics_code?: string | null
          state?: string | null
          street?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          zip?: string | null
        }
        Update: {
          certifying_executive_name?: string | null
          certifying_executive_title?: string | null
          city?: string | null
          created_at?: string | null
          created_by?: string | null
          establishment_name?: string | null
          hours_employees_by_year?: Json | null
          id?: string | null
          is_partial_year?: boolean | null
          ita_api_token?: string | null
          ita_establishment_id?: string | null
          naics_code?: string | null
          state?: string | null
          street?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "osha_establishments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      prop65_compliance_status: {
        Row: {
          active_warnings_count: number | null
          annual_review_due_at: string | null
          confirmed_links_count: number | null
          gap_count: number | null
          latest_review_at: string | null
          public_slug: string | null
          signed_assessments_count: number | null
          site_id: string | null
          site_name: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prop65_sites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_controls_hierarchy: {
        Row: {
          control_id: string | null
          created_at: string | null
          custom_name: string | null
          hierarchy_level: string | null
          hierarchy_level_long: string | null
          id: string | null
          implemented_at: string | null
          notes: string | null
          risk_id: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          verified_at: string | null
        }
        Insert: {
          control_id?: string | null
          created_at?: string | null
          custom_name?: string | null
          hierarchy_level?: never
          hierarchy_level_long?: string | null
          id?: string | null
          implemented_at?: string | null
          notes?: string | null
          risk_id?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Update: {
          control_id?: string | null
          created_at?: string | null
          custom_name?: string | null
          hierarchy_level?: never
          hierarchy_level_long?: string | null
          id?: string | null
          implemented_at?: string | null
          notes?: string | null
          risk_id?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_controls_control_id_fkey"
            columns: ["control_id"]
            isOneToOne: false
            referencedRelation: "controls_library"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_controls_risk_id_fkey"
            columns: ["risk_id"]
            isOneToOne: false
            referencedRelation: "risks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_controls_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      safety_board_trending: {
        Row: {
          acknowledgement_required: boolean | null
          board_id: string | null
          created_at: string | null
          is_anonymous: boolean | null
          kind: string | null
          last_reply_at: string | null
          locked: boolean | null
          pinned: boolean | null
          reaction_count_7d: number | null
          reply_count_7d: number | null
          score: number | null
          tenant_id: string | null
          thread_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "safety_board_threads_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "safety_boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "safety_board_threads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      training_matrix_placeholder: {
        Row: {
          completed_at: string | null
          department: string | null
          expires_at: string | null
          full_name: string | null
          position_title: string | null
          recurrence_months: number | null
          requirement_label: string | null
          role: string | null
          shift_label: string | null
          status: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "worker_position_assignments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_chemical_expiring_soon: {
        Row: {
          barcode: string | null
          days_remaining: number | null
          expiration_date: string | null
          id: string | null
          location_id: string | null
          location_path: string | null
          manufacturer: string | null
          product_id: string | null
          product_name: string | null
          quantity: number | null
          status: string | null
          tenant_id: string | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "chemical_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_chemical_jha_usage: {
        Row: {
          jha_count: number | null
          jha_ids: string[] | null
          product_id: string | null
          step_count: number | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jha_step_chemicals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_step_chemicals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "jha_step_chemicals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_chemical_maq_status: {
        Row: {
          containers_in_other_units: number | null
          exceeds_cap: boolean | null
          headroom: number | null
          location_id: string | null
          max_quantity: number | null
          notes: string | null
          product_id: string | null
          reference: string | null
          rule_id: string | null
          storage_class: string | null
          tenant_id: string | null
          total_in_unit: number | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_max_allowable_quantities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "chemical_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["location_id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "chemical_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_chemical_tier_two"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "chemical_max_allowable_quantities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_chemical_tier_two: {
        Row: {
          average_daily_quantity: number | null
          cas_numbers: string[] | null
          container_count: number | null
          dot_hazard_class: string | null
          dot_packing_group: string | null
          dot_un_number: string | null
          earliest_expiration: string | null
          ghs_pictograms: string[] | null
          ghs_signal_word: string | null
          location_id: string | null
          location_name: string | null
          location_path: string | null
          manufacturer: string | null
          max_daily_quantity: number | null
          nfpa_flammability: number | null
          nfpa_health: number | null
          nfpa_instability: number | null
          nfpa_special: string | null
          physical_state: string | null
          product_id: string | null
          product_name: string | null
          storage_class: string | null
          tenant_id: string | null
          total_quantity: number | null
          unit: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chemical_inventory_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_jha_step_required_ppe: {
        Row: {
          derived_ppe: string[] | null
          product_ids: string[] | null
          step_id: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jha_step_chemicals_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "jha_steps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jha_step_chemicals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_member_duplicate_identifiers: {
        Row: {
          duplicate_count: number | null
          identifier_type: string | null
          member_ids: string[] | null
          search_key_hash: string | null
          tenant_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_identifier_hashes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_member_roster: {
        Row: {
          avatar_url: string | null
          badge_id: string | null
          created_at: string | null
          department: string | null
          display_name: string | null
          display_name_source: string | null
          email: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          employee_id: string | null
          employment_type: string | null
          handle: string | null
          is_admin: boolean | null
          is_superadmin: boolean | null
          language: string | null
          legal_name: string | null
          member_code: string | null
          member_id: string | null
          notification_preferences: Json | null
          phone: string | null
          position_title: string | null
          preferred_name: string | null
          profile_id: string | null
          pronouns: string | null
          readiness_status: string | null
          shift_label: string | null
          site_label: string | null
          status: string | null
          supervisor_member_id: string | null
          supervisor_name: string | null
          tenant_id: string | null
          tenant_role: string | null
          updated_at: string | null
          vendor_company: string | null
        }
        Relationships: [
          {
            foreignKeyName: "members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_supervisor_member_id_fkey"
            columns: ["supervisor_member_id"]
            isOneToOne: false
            referencedRelation: "loto_workers_v"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_supervisor_member_id_fkey"
            columns: ["supervisor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "members_supervisor_member_id_fkey"
            columns: ["supervisor_member_id"]
            isOneToOne: false
            referencedRelation: "v_member_roster"
            referencedColumns: ["member_id"]
          },
          {
            foreignKeyName: "members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      v_training_matrix: {
        Row: {
          category: string | null
          completed_at: string | null
          course_code: string | null
          course_id: string | null
          course_title: string | null
          department: string | null
          display_name: string | null
          expires_at: string | null
          member_id: string | null
          position_title: string | null
          status: string | null
          tenant_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _gen_qr_token: { Args: never; Returns: string }
      _hygiene_now_iso: { Args: never; Returns: string }
      active_facility_id: { Args: never; Returns: string }
      active_tenant_id: { Args: never; Returns: string }
      ai_invocation_token_totals: {
        Args: { p_since: string; p_tenant: string }
        Returns: {
          cache_read_tokens: number
          cache_write_tokens: number
          input_tokens: number
          model: string
          output_tokens: number
        }[]
      }
      apply_approved_audit_changes: {
        Args: { p_applied_by?: string; p_run_id: string }
        Returns: number
      }
      apply_audit_change: {
        Args: { p_applied_by?: string; p_change_id: string }
        Returns: string
      }
      apply_staged_photo_replacement: {
        Args: { p_applied_by?: string; p_replacement_id: string }
        Returns: string
      }
      audit_log_hold_scope: { Args: { p_table: string }; Returns: string }
      audit_log_retention_class: { Args: { p_table: string }; Returns: string }
      audit_log_retention_days: {
        Args: { p_class: string; p_tenant: string }
        Returns: number
      }
      audit_member_drift: { Args: never; Returns: undefined }
      auth_user_id_by_email: { Args: { p_email: string }; Returns: string }
      bbs_points_for_kind: {
        Args: { p_kind: string; p_score: number }
        Returns: number
      }
      bbs_score_for: {
        Args: { likelihood: string; severity: string }
        Returns: number
      }
      can_view_care_phi: { Args: { p_incident_id: string }; Returns: boolean }
      can_view_incident_pii: {
        Args: { p_incident_id: string }
        Returns: boolean
      }
      capture_audit_snapshot: {
        Args: { p_captured_by?: string; p_reason?: string; p_run_id: string }
        Returns: string
      }
      chat_unread_counts: {
        Args: { p_tenant: string; p_user: string }
        Returns: {
          channel_id: string
          muted: boolean
          unread_count: number
        }[]
      }
      chemical_next_barcode: { Args: { p_tenant: string }; Returns: string }
      chemical_restricted_match: {
        Args: { p_cas: string[]; p_name: string; p_tenant: string }
        Returns: {
          alternative: string | null
          cas_number: string | null
          created_at: string
          created_by: string | null
          id: string
          name_pattern: string | null
          reason: string | null
          reference: string | null
          severity: string
          tenant_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "chemical_restricted_list"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chemical_synonyms_text: { Args: { vals: string[] }; Returns: string }
      close_loto_group_permit: {
        Args: { p_close_notes?: string; p_permit_id: string }
        Returns: undefined
      }
      create_construction_project: {
        Args: {
          p_created_by?: string
          p_jurisdiction?: string
          p_name: string
          p_project_type?: string
          p_start_date?: string
          p_tenant_id: string
          p_timezone: string
        }
        Returns: {
          actual_end_date: string | null
          address_line1: string | null
          city: string | null
          client_project_number: string | null
          country: string
          created_at: string
          created_by: string | null
          default_work_days: number[]
          description: string | null
          facility_id: string
          id: string
          jurisdiction_id: string
          latitude: number | null
          longitude: number | null
          name: string
          postal_code: string | null
          project_number: string | null
          project_type: string
          scheduled_end_date: string | null
          settings: Json
          start_date: string | null
          state: string | null
          status: string
          tenant_id: string
          timezone: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "construction_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      current_member_ids: { Args: never; Returns: string[] }
      current_user_admin_tenant_ids: { Args: never; Returns: string[] }
      current_user_is_admin: { Args: never; Returns: boolean }
      current_user_owner_tenant_ids: { Args: never; Returns: string[] }
      current_user_supervised_company_ids: { Args: never; Returns: string[] }
      current_user_tenant_ids: { Args: never; Returns: string[] }
      emit_push: { Args: { payload: Json }; Returns: undefined }
      exec_readonly_sql: {
        Args: { max_rows?: number; sql_text: string }
        Returns: Json
      }
      fire_webhooks: {
        Args: { event_type: string; payload: Json }
        Returns: undefined
      }
      generate_project_calendar: {
        Args: {
          p_from: string
          p_holidays?: string[]
          p_project_id: string
          p_tenant_id: string
          p_to: string
        }
        Returns: number
      }
      get_gate_context: {
        Args: { p_tenant: string; p_user: string }
        Returns: {
          is_superadmin: boolean
          role: string
          tenant_disabled_at: string
          tenant_exists: boolean
          tenant_modules: Json
          tenant_name: string
          tenant_settings: Json
        }[]
      }
      get_placard_by_qr: {
        Args: { p_ip?: string; p_token: string; p_user_agent?: string }
        Returns: Json
      }
      get_tenant_health: {
        Args: { p_since: string }
        Returns: {
          active_permits: number
          ai_invocations_30d: number
          equipment_count: number
          is_demo: boolean
          last_activity_at: string
          member_count: number
          name: string
          open_tickets: number
          status: string
          tenant_id: string
          tenant_number: string
          worker_count: number
        }[]
      }
      get_tenant_secret: {
        Args: { p_kind: string; p_tenant: string }
        Returns: string
      }
      handoff_loto_group_permit: {
        Args: { p_notes?: string; p_permit_id: string; p_to_user_id: string }
        Returns: undefined
      }
      is_iana_timezone: { Args: { p_zone: string }; Returns: boolean }
      is_safe_webhook_url: { Args: { url: string }; Returns: boolean }
      is_superadmin: { Args: never; Returns: boolean }
      loto_placard_publishable: {
        Args: { _equipment_id: string }
        Returns: {
          failing_gate: string
          publishable: boolean
          reason: string
        }[]
      }
      match_knowledge_chunks: {
        Args: {
          match_count?: number
          query_embedding: string
          source_filter?: Database["public"]["Enums"]["knowledge_source_type"][]
          tenant_filter?: string
        }
        Returns: {
          chunk_id: string
          chunk_index: number
          doc_tenant_id: string
          document_id: string
          effective_date: string
          jurisdiction: string
          metadata: Json
          similarity: number
          source_type: Database["public"]["Enums"]["knowledge_source_type"]
          source_url: string
          text: string
          title: string
        }[]
      }
      member_next_handle: {
        Args: {
          p_base: string
          p_existing_member_id?: string
          p_tenant_id: string
        }
        Returns: string
      }
      member_normalize_key: { Args: { p_value: string }; Returns: string }
      member_search_hash: { Args: { p_value: string }; Returns: string }
      member_slug: { Args: { p_value: string }; Returns: string }
      member_sync_identifier_hashes: {
        Args: { p_member_id: string }
        Returns: undefined
      }
      merge_members: {
        Args: {
          p_actor_id: string
          p_reason: string
          p_source_id: string
          p_target_id: string
        }
        Returns: string
      }
      next_hot_work_serial: { Args: { p_started_at: string }; Returns: string }
      next_permit_serial: { Args: { p_started_at: string }; Returns: string }
      next_signon_token: { Args: never; Returns: string }
      next_tenant_number: { Args: never; Returns: string }
      project_today: { Args: { p_project_id: string }; Returns: string }
      prune_anon_report_ip_attempts: { Args: never; Returns: undefined }
      recompute_project_calendar_ordinals: {
        Args: { p_project_id: string; p_tenant_id: string }
        Returns: undefined
      }
      reconcile_members_backfill: {
        Args: { p_tenant_id?: string }
        Returns: {
          inserted_count: number
          updated_count: number
        }[]
      }
      reconcile_review_link_photos: {
        Args: { p_applied_by?: string; p_review_link_id: string }
        Returns: number
      }
      reconcile_webhook_deliveries: {
        Args: { limit_n?: number }
        Returns: number
      }
      reject_staged_photo_replacement: {
        Args: {
          p_applied_by?: string
          p_reason?: string
          p_replacement_id: string
        }
        Returns: string
      }
      restore_audit_snapshot: {
        Args: { p_restored_by?: string; p_snapshot_id: string }
        Returns: Json
      }
      seed_incident_notification_defaults: {
        Args: { p_tenant_id: string }
        Returns: undefined
      }
      seed_wls_demo: { Args: never; Returns: string }
      seed_wls_iso14001_demo: { Args: never; Returns: string }
      seed_wls_worker_readiness_demo: { Args: never; Returns: string }
      set_tenant_secret: {
        Args: { p_kind: string; p_tenant: string; p_value: string }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      signoff_loto_review_link: {
        Args: {
          p_approved: boolean
          p_ip?: string
          p_notes: string
          p_review_link_id: string
          p_signature: string
          p_typed_name: string
          p_user_agent?: string
        }
        Returns: {
          review_link_id: string
        }[]
      }
      stage_loto_review_photo_replacement: {
        Args: {
          p_equipment_id: string
          p_ip?: string
          p_new_photo_url: string
          p_replaced_by_name?: string
          p_review_link_id: string
          p_slot: string
          p_storage_path: string
          p_user_agent?: string
        }
        Returns: {
          superseded_storage_path: string
        }[]
      }
      storage_path_tenant: { Args: { name: string }; Returns: string }
      update_manual: {
        Args: {
          p_body_md?: string
          p_change_note?: string
          p_clear_published?: boolean
          p_module_id: string
          p_published_at?: string
          p_summary?: string
          p_summary_set?: boolean
          p_title?: string
          p_updated_by?: string
        }
        Returns: {
          body_md: string
          body_tsv: unknown
          created_at: string
          created_by: string | null
          id: string
          module_id: string
          published_at: string | null
          summary: string | null
          title: string
          updated_at: string
          updated_by: string | null
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "manuals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_loto_placard_review: {
        Args: {
          p_equipment_id: string
          p_notes: string
          p_review_link_id: string
          p_status: string
        }
        Returns: undefined
      }
    }
    Enums: {
      knowledge_source_type:
        | "regulation"
        | "state_reg"
        | "dot"
        | "epa"
        | "rcra"
        | "company_policy"
        | "manual"
        | "module_manual"
      prop65_exposure_route: "inhalation" | "dermal" | "ingestion" | "multiple"
      prop65_harm_endpoint: "cancer" | "reproductive" | "both"
      prop65_link_confidence: "auto" | "confirmed"
      prop65_notification_method:
        | "posted_sign"
        | "training"
        | "email"
        | "pamphlet"
      prop65_warning_type: "long_form" | "short_form"
      wah_anchor_kind:
        | "engineered_permanent"
        | "engineered_portable"
        | "horizontal_lifeline"
        | "improvised"
      wah_component_type:
        | "harness"
        | "shock_lanyard"
        | "positioning_lanyard"
        | "restraint_lanyard"
        | "srl_class1"
        | "srl_class2"
        | "anchor_connector"
        | "rope_grab"
        | "trauma_strap"
        | "rescue_descent_device"
      wah_equipment_status:
        | "in_service"
        | "quarantined"
        | "condemned"
        | "in_rescue_cache"
        | "pending_recert"
      wah_inspection_kind: "pre_use" | "periodic" | "post_event"
      wah_inspection_outcome: "pass" | "concern" | "condemn"
      wah_ladder_duty: "IAA" | "IA" | "I" | "II" | "III"
      wah_ladder_material: "aluminum" | "fiberglass" | "wood" | "composite"
      wah_ladder_type: "extension" | "step" | "articulated" | "mobile"
      wah_permit_status: "active" | "completed" | "suspended" | "cancelled"
      wah_role: "authorized" | "competent" | "qualified"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      knowledge_source_type: [
        "regulation",
        "state_reg",
        "dot",
        "epa",
        "rcra",
        "company_policy",
        "manual",
        "module_manual",
      ],
      prop65_exposure_route: ["inhalation", "dermal", "ingestion", "multiple"],
      prop65_harm_endpoint: ["cancer", "reproductive", "both"],
      prop65_link_confidence: ["auto", "confirmed"],
      prop65_notification_method: [
        "posted_sign",
        "training",
        "email",
        "pamphlet",
      ],
      prop65_warning_type: ["long_form", "short_form"],
      wah_anchor_kind: [
        "engineered_permanent",
        "engineered_portable",
        "horizontal_lifeline",
        "improvised",
      ],
      wah_component_type: [
        "harness",
        "shock_lanyard",
        "positioning_lanyard",
        "restraint_lanyard",
        "srl_class1",
        "srl_class2",
        "anchor_connector",
        "rope_grab",
        "trauma_strap",
        "rescue_descent_device",
      ],
      wah_equipment_status: [
        "in_service",
        "quarantined",
        "condemned",
        "in_rescue_cache",
        "pending_recert",
      ],
      wah_inspection_kind: ["pre_use", "periodic", "post_event"],
      wah_inspection_outcome: ["pass", "concern", "condemn"],
      wah_ladder_duty: ["IAA", "IA", "I", "II", "III"],
      wah_ladder_material: ["aluminum", "fiberglass", "wood", "composite"],
      wah_ladder_type: ["extension", "step", "articulated", "mobile"],
      wah_permit_status: ["active", "completed", "suspended", "cancelled"],
      wah_role: ["authorized", "competent", "qualified"],
    },
  },
} as const
