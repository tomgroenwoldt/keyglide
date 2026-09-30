
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "challenge_comment_votes": {
                  Row: {
                    "comment_id": number,"id": number,"user_id": string,"vote": number
                  }
                  Insert: {
                    "comment_id": number,"id"?: number,"user_id"?: string,"vote": number
                  }
                  Update: {
                    "comment_id"?: number,"id"?: number,"user_id"?: string,"vote"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "challenge_comment_votes_comment_id_fkey"
      columns: ["comment_id"]
isOneToOne: false
      referencedRelation: "challenge_comments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "challenge_comment_votes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"challenge_comments": {
                  Row: {
                    "challenge_id": number,"content": string,"created_at": string,"id": number,"updated_at": string | null,"user_id": string
                  }
                  Insert: {
                    "challenge_id": number,"content": string,"created_at"?: string,"id"?: number,"updated_at"?: string | null,"user_id"?: string
                  }
                  Update: {
                    "challenge_id"?: number,"content"?: string,"created_at"?: string,"id"?: number,"updated_at"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "challenge_comments_challenge_id_fkey"
      columns: ["challenge_id"]
isOneToOne: false
      referencedRelation: "challenges"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "challenge_comments_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"challenge_likes": {
                  Row: {
                    "challenge_id": number,"id": number,"reaction": Database["public"]['Enums']["challenge_like"],"user_id": string
                  }
                  Insert: {
                    "challenge_id": number,"id"?: number,"reaction": Database["public"]['Enums']["challenge_like"],"user_id"?: string
                  }
                  Update: {
                    "challenge_id"?: number,"id"?: number,"reaction"?: Database["public"]['Enums']["challenge_like"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "challenge_likes_challenge_id_fkey"
      columns: ["challenge_id"]
isOneToOne: false
      referencedRelation: "challenges"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "challenge_likes_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"challenges": {
                  Row: {
                    "author_id": string | null,"created_at": string,"date": string | null,"description": string | null,"extension": Database["public"]['Enums']["prog_extension"],"goal": string,"id": number,"start": string,"title": string | null
                  }
                  Insert: {
                    "author_id"?: string | null,"created_at"?: string,"date"?: string | null,"description"?: string | null,"extension"?: Database["public"]['Enums']["prog_extension"],"goal": string,"id"?: number,"start": string,"title"?: string | null
                  }
                  Update: {
                    "author_id"?: string | null,"created_at"?: string,"date"?: string | null,"description"?: string | null,"extension"?: Database["public"]['Enums']["prog_extension"],"goal"?: string,"id"?: number,"start"?: string,"title"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "challenges_author_id_fkey"
      columns: ["author_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"full_name": string | null,"id": string,"streak": number | null,"user_name": string
                  }
                  Insert: {
                    "avatar_url"?: string | null,"full_name"?: string | null,"id": string,"streak"?: number | null,"user_name": string
                  }
                  Update: {
                    "avatar_url"?: string | null,"full_name"?: string | null,"id"?: string,"streak"?: number | null,"user_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"scores": {
                  Row: {
                    "id": number,"solution_id": number | null,"start_time": string,"stop_time": string,"user_id": string | null
                  }
                  Insert: {
                    "id"?: number,"solution_id"?: number | null,"start_time": string,"stop_time": string,"user_id"?: string | null
                  }
                  Update: {
                    "id"?: number,"solution_id"?: number | null,"start_time"?: string,"stop_time"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "scores_solution_id_fkey"
      columns: ["solution_id"]
isOneToOne: false
      referencedRelation: "solutions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "scores_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"solutions": {
                  Row: {
                    "challenge_id": number,"id": number,"keys": (string)[],"user_id": string | null
                  }
                  Insert: {
                    "challenge_id": number,"id"?: number,"keys": (string)[],"user_id"?: string | null
                  }
                  Update: {
                    "challenge_id"?: number,"id"?: number,"keys"?: (string)[],"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "solutions_challenge_id_fkey"
      columns: ["challenge_id"]
isOneToOne: false
      referencedRelation: "challenges"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "solutions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_settings": {
                  Row: {
                    "line_number": string,"user_id": string
                  }
                  Insert: {
                    "line_number"?: string,"user_id": string
                  }
                  Update: {
                    "line_number"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "user_settings_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "ranked_solutions": {
                  Row: {
                    "avatar_url": string | null,"challenge_id": number | null,"date": string | null,"full_name": string | null,"hidden_today": boolean | null,"id": number | null,"keys": (string)[] | null,"place": number | null,"streak": number | null,"user_id": string | null,"user_name": string | null
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "delete_comment":
{ Args: { "p_comment_id": number }; Returns: undefined
                           },
"get_challenge_comments":
{ Args: { "p_challenge_id": number }; Returns: {
              "avatar_url": string,"content": string,"created_at": string,"id": number,"my_vote": number,"net_score": number,"updated_at": string,"user_id": string,"user_name": string
            }[]
                           },
"get_challenge_reaction_state":
{ Args: { "p_challenge_id": number }; Returns: {
              "down_count": number,"my_reaction": Database["public"]['Enums']["challenge_like"],"up_count": number
            }[]
                           },
"get_challenges":
{ Args: { "author_filter"?: string,"extension_filter"?: Database["public"]['Enums']["prog_extension"],"filter_type"?: Database["public"]['Enums']["challenge_filter"],"status_filter"?: Database["public"]['Enums']["challenge_status"] }; Returns: {
              "author_id": string,"author_name": string,"created_at": string,"date": string,"description": string,"down_count": number,"extension": Database["public"]['Enums']["prog_extension"],"goal": string,"id": number,"like_count": number,"play_count": number,"played_by_me": boolean,"queue_place": number,"start": string,"title": string,"up_count": number
            }[]
                           },
"get_leaderboard":
{ Args: { "period": string }; Returns: {
              "avatar_url": string,"best_dates": (string)[],"full_name": string,"rank": number,"total_solutions_count": number,"user_id": string,"user_name": string
            }[]
                           },
"get_ranked_solutions":
{ Args: Record<PropertyKey, never>; Returns: {
              "avatar_url": string,"challenge_id": number,"date": string,"full_name": string,"hidden_today": boolean,"id": number,"keys": (string)[],"place": number,"streak": number,"user_id": string,"user_name": string
            }[]
                           },
"promote_challenge_for_date":
{ Args: { "target_date": string }; Returns: number
                           },
"reset_streaks_for_missed_day":
{ Args: { "target_date": string }; Returns: number
                           },
"toggle_challenge_reaction":
{ Args: { "p_challenge_id": number,"p_reaction": Database["public"]['Enums']["challenge_like"] }; Returns: undefined
                           },
"toggle_comment_vote":
{ Args: { "p_comment_id": number,"p_vote": number }; Returns: undefined
                           },
"update_comment":
{ Args: { "p_comment_id": number,"p_content": string }; Returns: undefined
                           }
          }
          Enums: {
            "challenge_filter": "most_recent"|"most_played"|"most_liked"|"played_by_me"|"not_played_by_me","challenge_like": "up"|"down","challenge_status": "all"|"queued"|"live"|"past","duel_status": "Waiting"|"Starting"|"InProgress"|"Closing"|"Finished","prog_extension": "js"|"ts"|"py"|"cpp"|"java"|"rb"|"go"|"rs"|"php"|"swift"|"unknown"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "challenge_filter": ["most_recent", "most_played", "most_liked", "played_by_me", "not_played_by_me"],"challenge_like": ["up", "down"],"challenge_status": ["all", "queued", "live", "past"],"duel_status": ["Waiting", "Starting", "InProgress", "Closing", "Finished"],"prog_extension": ["js", "ts", "py", "cpp", "java", "rb", "go", "rs", "php", "swift", "unknown"]
          }
        }
} as const

