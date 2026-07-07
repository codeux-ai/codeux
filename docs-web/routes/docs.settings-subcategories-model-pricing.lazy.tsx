import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesModelPricingContent from '../content/docs/settings-subcategories-model-pricing.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-model-pricing')({
  component: () => (
    <DocsPage id="settings-subcategories-model-pricing">
      <SettingsSubcategoriesModelPricingContent />
    </DocsPage>
  )
})
