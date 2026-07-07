import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesSystemRuntimeContent from '../content/docs/settings-subcategories-system-runtime.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-system-runtime')({
  component: () => (
    <DocsPage id="settings-subcategories-system-runtime">
      <SettingsSubcategoriesSystemRuntimeContent />
    </DocsPage>
  )
})
