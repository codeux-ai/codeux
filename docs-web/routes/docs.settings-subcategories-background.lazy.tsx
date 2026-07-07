import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesBackgroundContent from '../content/docs/settings-subcategories-background.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-background')({
  component: () => (
    <DocsPage id="settings-subcategories-background">
      <SettingsSubcategoriesBackgroundContent />
    </DocsPage>
  )
})
