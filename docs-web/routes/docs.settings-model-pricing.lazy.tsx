import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsModelPricingContent from '../content/docs/settings-model-pricing.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-model-pricing')({
  component: () => (
    <DocsPage id="settings-model-pricing">
      <SettingsModelPricingContent />
    </DocsPage>
  )
})
