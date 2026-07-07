import { createLazyFileRoute } from '@tanstack/react-router'
import SettingsSubcategoriesRateLimitContent from '../content/docs/settings-subcategories-rate-limit.mdx'
import { DocsPage } from '../components/docs/DocsPage'

export const Route = createLazyFileRoute('/docs/settings-subcategories-rate-limit')({
  component: () => (
    <DocsPage id="settings-subcategories-rate-limit">
      <SettingsSubcategoriesRateLimitContent />
    </DocsPage>
  )
})
