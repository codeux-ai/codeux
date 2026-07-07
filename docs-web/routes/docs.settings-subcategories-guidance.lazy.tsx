import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesGuidanceContent from '../content/docs/settings-subcategories-guidance.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-guidance')({
  component: () => (
    <DocsPage id="settings-subcategories-guidance">
      <SettingsSubcategoriesGuidanceContent />
    </DocsPage>
  )
})
