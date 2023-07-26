import { AppBskyGraphDefs } from '../client/index'
import {
  Label,
  LabelDefinitionPreference,
  ModerationCause,
  ModerationOpts,
  ModerationDecision,
} from './types'
import { LABELS } from './const/labels'

export class ModerationCauseAccumulator {
  canHide = true
  causes: ModerationCause[] = []

  constructor() {}

  setIsMe(isMe: boolean) {
    if (isMe) {
      this.canHide = false
    }
  }

  addBlocking(blocking: string | undefined) {
    if (blocking) {
      this.causes.push({
        type: 'blocking',
        source: { type: 'user' },
        priority: 1,
      })
    }
  }

  addBlockedBy(blockedBy: boolean | undefined) {
    if (blockedBy) {
      this.causes.push({
        type: 'blocked-by',
        source: { type: 'user' },
        priority: 2,
      })
    }
  }

  addLabel(label: Label, opts: ModerationOpts) {
    // look up the label definition
    const labelDef = LABELS[label.val]
    if (!labelDef) {
      // ignore labels we don't understand
      return
    }

    // look up the label preference
    // TODO use the find() when 3P labelers support lands
    // const labelerSettings = opts.labelerSettings.find(
    //   (s) => s.labeler.did === label.src,
    // )
    const labelerSettings = opts.labelerSettings[0]
    if (!labelerSettings) {
      // ignore labels from labelers we don't use
      return
    }

    // establish the label preference for interpretation
    let labelPref: LabelDefinitionPreference = 'ignore'
    if (!labelDef.configurable) {
      labelPref = labelDef.preferences[0]
    } else if (labelDef.flags.includes('adult') && !opts.adultContentEnabled) {
      labelPref = 'hide'
    } else if (labelerSettings.settings[label.val]) {
      labelPref = labelerSettings.settings[label.val]
    }

    // ignore labels the user has asked to ignore
    if (labelPref === 'ignore') {
      return
    }

    // downgrade hide preferences if we can't hide
    // (used when viewing your own content)
    if (!this.canHide && labelPref === 'hide') {
      labelPref = 'warn'
    }

    // establish the priority of the label
    let priority: 3 | 4 | 5 | 7 | 8
    if (labelDef.flags.includes('no-override')) {
      priority = 3
    } else if (labelPref === 'hide') {
      priority = 4
    } else if (labelDef.onwarn === 'blur') {
      priority = 5
    } else if (labelDef.onwarn === 'blur-media') {
      priority = 7
    } else {
      priority = 8
    }

    this.causes.push({
      type: 'label',
      label,
      labelDef,
      labeler: labelerSettings.labeler,
      setting: labelPref,
      priority,
    })
  }

  addMuted(muted: boolean | undefined) {
    if (muted) {
      this.causes.push({
        type: 'muted',
        source: { type: 'user' },
        priority: 6,
      })
    }
  }

  addMutedByList(mutedByList: AppBskyGraphDefs.ListViewBasic | undefined) {
    if (mutedByList) {
      this.causes.push({
        type: 'muted',
        source: { type: 'list', list: mutedByList },
        priority: 6,
      })
    }
  }

  finalizeDecision(opts: ModerationOpts): ModerationDecision {
    const mod = new ModerationDecision()
    if (!this.causes.length) {
      return mod
    }

    // sort the causes by priority and then choose the top one
    this.causes.sort((a, b) => a.priority - b.priority)
    mod.cause = this.causes[0]
    mod.additionalCauses = this.causes.slice(1)

    // blocked user
    if (mod.cause.type === 'blocking' || mod.cause.type === 'blocked-by') {
      // filter and blur, dont allow override
      mod.filter = true
      mod.blur = true
      mod.noOverride = true
    }
    // muted user
    else if (mod.cause.type === 'muted') {
      // filter and blur
      mod.filter = true
      mod.blur = true
    }
    // labeled subject
    else if (mod.cause.type === 'label') {
      // 'hide' setting
      if (mod.cause.setting === 'hide') {
        // filter
        mod.filter = true
      }

      // 'hide' and 'warn' setting, apply onwarn
      switch (mod.cause.labelDef.onwarn) {
        case 'alert':
          mod.alert = true
          break
        case 'blur':
          mod.blur = true
          break
        case 'blur-media':
          mod.blurMedia = true
          break
        case null:
          // do nothing
          break
      }

      // apply noOverride as needed
      if (mod.cause.labelDef.flags.includes('no-override')) {
        mod.noOverride = true
      } else if (
        mod.cause.labelDef.flags.includes('adult') &&
        !opts.adultContentEnabled
      ) {
        mod.noOverride = true
      }
    }

    return mod
  }
}
