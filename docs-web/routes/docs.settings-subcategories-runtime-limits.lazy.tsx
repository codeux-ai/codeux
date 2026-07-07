import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesRuntimeLimitsContent from '../content/docs/settings-subcategories-runtime-limits.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-runtime-limits')({
  component: () => (
    <DocsPage id="settings-subcategories-runtime-limits">
      <SettingsSubcategoriesRuntimeLimitsContent />
    </DocsPage>
  )
})
