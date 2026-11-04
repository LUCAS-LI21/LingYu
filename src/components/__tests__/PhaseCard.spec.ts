import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h } from 'vue'

import PhaseCard from '../PhaseCard.vue'

const DummyIcon = () => h('span', { class: 'dummy-icon' })

const baseProps = {
  index: 3,
  title: '实现',
  subtitle: 'Implement',
  desc: 'Vite 秒级热更新，类型全链路可查。',
  icon: DummyIcon,
  tools: ['Vite', 'Pinia', 'ESLint'],
}

function buildProps(overrides: Partial<typeof baseProps> = {}) {
  return { ...baseProps, ...overrides }
}

describe('PhaseCard', () => {
  it('渲染阶段序号、标题与描述', () => {
    const wrapper = mount(PhaseCard, { props: buildProps() })

    expect(wrapper.text()).toContain('STEP 3')
    expect(wrapper.text()).toContain('实现')
    expect(wrapper.text()).toContain('Vite 秒级热更新')
  })

  it('工具标签数量与传入一致', () => {
    const wrapper = mount(PhaseCard, { props: buildProps() })
    expect(wrapper.findAll('li')).toHaveLength(3)
  })

  it('图标作为组件被渲染出来', () => {
    const wrapper = mount(PhaseCard, { props: buildProps() })
    expect(wrapper.find('.dummy-icon').exists()).toBe(true)
  })
})
