import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument, Types } from 'mongoose'

export type LoginEventDocument = HydratedDocument<LoginEvent>

/**
 * One document per successful login. Powers admin-only daily login analytics.
 * `date` is the UTC YYYY-MM-DD bucket (string, matching analytics aggregations)
 * so day-wise counts avoid timezone ambiguity.
 */
@Schema({ timestamps: true })
export class LoginEvent {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  declare userId: Types.ObjectId

  @Prop({ required: true, lowercase: true, trim: true })
  declare email: string

  @Prop({ required: true })
  declare name: string

  @Prop({ required: true })
  declare role: string

  // UTC YYYY-MM-DD bucket for the login
  @Prop({ required: true, index: true })
  declare date: string

  @Prop({ type: String })
  ipAddress?: string
}

export const LoginEventSchema = SchemaFactory.createForClass(LoginEvent)

// Common access pattern: day-wise grouping over a date range
LoginEventSchema.index({ date: 1, userId: 1 })
