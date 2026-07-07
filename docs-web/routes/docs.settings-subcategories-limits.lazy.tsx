import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesLimitsContent from '../content/docs/settings-subcategories-limits.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-limits')({
  component: () => (
    <DocsPage id="settings-subcategories-limits">
      <SettingsSubcategoriesLimitsContent />
    </DocsPage>
  )
})
