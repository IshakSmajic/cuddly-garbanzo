export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      blocks: {
        Row: {
          blocked_id: string;
          blocker_id: string;
          created_at: string;
        };
        ComputedFields: never;
        Insert: {
          blocked_id: string;
          blocker_id: string;
          created_at?: string;
        };
        Update: {
          blocked_id?: string;
          blocker_id?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey";
            columns: ["blocked_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey";
            columns: ["blocker_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      conversation_members: {
        Row: {
          conversation_id: string;
          joined_at: string;
          last_read_message_id: number | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          conversation_id: string;
          joined_at?: string;
          last_read_message_id?: number | null;
          user_id: string;
        };
        Update: {
          conversation_id?: string;
          joined_at?: string;
          last_read_message_id?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_members_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_last_read_message";
            columns: ["last_read_message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      conversations: {
        Row: {
          created_at: string;
          id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
        };
        Relationships: [];
      };
      direct_conversations: {
        Row: {
          conversation_id: string;
          user_high_id: string | null;
          user_low_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          conversation_id: string;
          user_high_id?: string | null;
          user_low_id?: string | null;
        };
        Update: {
          conversation_id?: string;
          user_high_id?: string | null;
          user_low_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "direct_conversations_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: true;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "direct_conversations_user_high_id_fkey";
            columns: ["user_high_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "direct_conversations_user_low_id_fkey";
            columns: ["user_low_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      friend_requests: {
        Row: {
          created_at: string;
          id: string;
          recipient_id: string;
          requester_id: string;
          responded_at: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          recipient_id: string;
          requester_id: string;
          responded_at?: string | null;
          status?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          recipient_id?: string;
          requester_id?: string;
          responded_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friend_requests_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "friend_requests_requester_id_fkey";
            columns: ["requester_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      friendships: {
        Row: {
          created_at: string;
          user_high_id: string;
          user_low_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_high_id: string;
          user_low_id: string;
        };
        Update: {
          created_at?: string;
          user_high_id?: string;
          user_low_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "friendships_user_high_id_fkey";
            columns: ["user_high_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "friendships_user_low_id_fkey";
            columns: ["user_low_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      message_attachments: {
        Row: {
          created_at: string;
          height: number;
          id: number;
          message_id: number;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          width: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          height: number;
          id?: never;
          message_id: number;
          mime_type: string;
          size_bytes: number;
          storage_path: string;
          width: number;
        };
        Update: {
          created_at?: string;
          height?: number;
          id?: never;
          message_id?: number;
          mime_type?: string;
          size_bytes?: number;
          storage_path?: string;
          width?: number;
        };
        Relationships: [
          {
            foreignKeyName: "message_attachments_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          client_id: string;
          content: string | null;
          conversation_id: string;
          created_at: string;
          id: number;
          sender_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          client_id: string;
          content?: string | null;
          conversation_id: string;
          created_at?: string;
          id?: never;
          sender_id?: string | null;
        };
        Update: {
          client_id?: string;
          content?: string | null;
          conversation_id?: string;
          created_at?: string;
          id?: never;
          sender_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_member";
            columns: ["conversation_id", "sender_id"];
            isOneToOne: false;
            referencedRelation: "conversation_members";
            referencedColumns: ["conversation_id", "user_id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_path: string | null;
          bio: string | null;
          created_at: string;
          display_name: string | null;
          updated_at: string;
          user_id: string;
          username: string | null;
        };
        ComputedFields: never;
        Insert: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string | null;
          updated_at?: string;
          user_id: string;
          username?: string | null;
        };
        Update: {
          avatar_path?: string | null;
          bio?: string | null;
          created_at?: string;
          display_name?: string | null;
          updated_at?: string;
          user_id?: string;
          username?: string | null;
        };
        Relationships: [];
      };
      search_events: {
        Row: {
          created_at: string;
          id: number;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: never;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: never;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "search_events_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      block_user: { Args: { target: string }; Returns: undefined };
      cancel_friend_request: { Args: { request_id: string }; Returns: undefined };
      mark_read: { Args: { conversation: string; message: number }; Returns: undefined };
      messages_page: {
        Args: {
          before_created_at?: string;
          before_id?: number;
          conversation: string;
          page_size?: number;
        };
        Returns: {
          client_id: string;
          content: string | null;
          conversation_id: string;
          created_at: string;
          id: number;
          sender_id: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "messages";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      my_conversations: {
        Args: { only_conversation?: string };
        Returns: {
          avatar_path: string;
          conversation_id: string;
          display_name: string;
          is_friend: boolean;
          last_at: string;
          last_content: string;
          last_sender_id: string;
          other_id: string;
          unread_count: number;
          username: string;
        }[];
      };
      orphan_files: {
        Args: { max_files?: number; min_age?: string };
        Returns: {
          bucket_id: string;
          name: string;
        }[];
      };
      relationship_with: {
        Args: { other: string };
        Returns: {
          relation: string;
          request_id: string;
        }[];
      };
      remove_avatar: { Args: Record<PropertyKey, never>; Returns: string };
      respond_to_friend_request: { Args: { accept: boolean; request_id: string }; Returns: string };
      search_users: {
        Args: { query: string };
        Returns: {
          avatar_path: string;
          display_name: string;
          relation: string;
          request_id: string;
          user_id: string;
          username: string;
        }[];
      };
      send_friend_request: { Args: { recipient: string }; Returns: string };
      send_image_message: {
        Args: {
          caption?: string;
          client_id: string;
          conversation: string;
          height: number;
          path: string;
          width: number;
        };
        Returns: {
          client_id: string;
          content: string | null;
          conversation_id: string;
          created_at: string;
          id: number;
          sender_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "messages";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_avatar: { Args: { new_path: string }; Returns: string };
      unblock_user: { Args: { target: string }; Returns: undefined };
      unfriend: { Args: { other: string }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
