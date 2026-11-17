import defaultAvatar from '../../assets/agent-characters/default.png'
import chillAvatar from '../../assets/agent-characters/chill.png'
import hypeAvatar from '../../assets/agent-characters/hype.png'
import empatheticAvatar from '../../assets/agent-characters/empathetic.png'
import auditorAvatar from '../../assets/agent-characters/auditor.png'
import mentorAvatar from '../../assets/agent-characters/mentor.png'
import type { AgentPreferences } from '../../types'

export type CharacterId = NonNullable<AgentPreferences['character']>

export const CHARACTER_AVATARS: Record<CharacterId, string> = {
  default: defaultAvatar,
  chill: chillAvatar,
  hype: hypeAvatar,
  empathetic: empatheticAvatar,
  auditor: auditorAvatar,
  mentor: mentorAvatar,
}
