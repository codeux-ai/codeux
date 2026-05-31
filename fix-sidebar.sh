#!/bin/bash
git restore dashboard/src/v2/components/layout/Sidebar.tsx
cat << 'INNER_EOF' > patch_sidebar.diff
--- dashboard/src/v2/components/layout/Sidebar.tsx
+++ dashboard/src/v2/components/layout/Sidebar.tsx
@@ -54,7 +54,7 @@
     });
     const matches = useRouterState({ select: (s) => s.matches });
     const currentPath = (matches && matches.length > 0) ? (matches[matches.length - 1]?.pathname || "/") : "/";
-    const activeIndex = Math.max(0, navItems.findIndex(i => i.path === currentPath));
+    const activeIndex = navItems.findIndex(i => currentPath === i.path || (i.path !== "/" && currentPath.startsWith(i.path)));

     useEffect(() => {
         if (!isMobile && sidebarRef.current) {
@@ -129,9 +129,9 @@
         <aside
             aria-label="Primary Navigation"
             ref={sidebarRef}
-            className={`h-full shrink-0 border-r border-slate-200 dark:border-white/[0.04] bg-slate-50 dark:bg-void-900 flex flex-col justify-between py-8 z-50 transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
+            className={`h-full shrink-0 border-r border-slate-200 dark:border-white/[0.04] bg-slate-50/80 dark:bg-void-900 flex flex-col justify-between py-8 z-50 transition-all duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] ${
                 isMobile
-                    ? 'fixed left-0 top-0 w-[260px] -translate-x-full opacity-0 shadow-2xl bg-slate-50 dark:bg-void-900'
+                    ? 'fixed left-0 top-0 w-[260px] -translate-x-full opacity-0 shadow-2xl bg-slate-50 dark:bg-void-900'
                     : (isMinimized ? 'relative w-[88px]' : 'relative w-[260px]')
             }`}
         >
@@ -156,7 +156,7 @@

             {/* Navigation */}
             <nav ref={navRef} className="flex-1 flex flex-col relative z-10">
-                <h2 className={`px-8 text-[9px] font-bold text-slate-400 dark:text-slate-600 uppercase tracking-[0.16em] mb-3 transition-all duration-500 overflow-hidden ${isMinimized && !isMobile ? 'w-0 h-0 opacity-0 m-0' : 'opacity-100'}`}>
+                <h2 className={`px-8 text-[9px] font-bold text-slate-600 dark:text-slate-600 uppercase tracking-[0.16em] mb-3 transition-all duration-500 overflow-hidden ${isMinimized && !isMobile ? 'w-0 h-0 opacity-0 m-0' : 'opacity-100'}`}>
                     Workspace
                 </h2>
                 {navItems.map((item, idx) => {
@@ -188,17 +188,23 @@

             {/* Settings & Toggle */}
             <div className="relative z-10 flex flex-col">
+                {(() => {
+                    const isConfigActive = currentPath.startsWith("/config");
+                    return (
                 <Link
                     to="/config"
                     onClick={isMobile ? onClose : undefined}
                     aria-label="Settings"
                     data-tour-id="nav-config"
                     className={`relative flex items-center ${isMinimized && !isMobile ? 'justify-center mx-4' : 'gap-3.5 px-5 mx-4'} py-3 min-h-[44px] rounded-2xl transition-all duration-300 group mb-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 focus-visible:rounded-2xl focus-visible:z-10 decoration-none`}
                 >
-                    <div className="absolute inset-0 rounded-2xl bg-black/[0.05] dark:bg-white/[0.05] transition-all duration-300 pointer-events-none origin-left opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100" />
-                    <Settings aria-hidden="true" className="relative z-10 w-4 h-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 group-hover:rotate-90 transition-all duration-700 ease-in-out" strokeWidth={1.5} />
+                    <div className={`absolute inset-0 rounded-2xl transition-all duration-300 pointer-events-none origin-left ${isConfigActive ? 'bg-signal-500/[0.10] dark:bg-signal-500/[0.10] opacity-100 translate-x-0' : 'bg-black/[0.05] dark:bg-white/[0.05] opacity-0 -translate-x-full group-hover:translate-x-0 group-hover:opacity-100'}`} />
+                    <div className={`absolute inset-0 rounded-2xl pointer-events-none transition-all duration-300 ${isConfigActive ? 'shadow-[inset_0_0_0_1px_rgba(0,224,160,0.12)] dark:shadow-[inset_0_0_0_1px_rgba(0,224,160,0.1)]' : 'shadow-none'}`} />
+                    {isConfigActive && (
+                        <div className="absolute left-0 top-1/2 -translate-y-1/2 h-2/3 w-1 bg-signal-500 rounded-r-full shadow-[0_0_8px_rgba(0,224,160,0.6)]" />
+                    )}
+                    <Settings aria-hidden="true" className={`relative z-10 w-4 h-4 transition-all duration-700 ease-in-out shrink-0 ${isConfigActive ? 'text-signal-600 dark:text-signal-400 drop-shadow-[0_0_8px_rgba(0,224,160,0.5)]' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 group-hover:rotate-90'}`} strokeWidth={isConfigActive ? 2 : 1.5} />
                     <div className={`relative z-10 overflow-hidden transition-all duration-500 ${isMinimized && !isMobile ? 'w-0 opacity-0' : 'opacity-100'}`}>
-                        <span className="font-medium text-sm tracking-wide text-slate-500 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors duration-300 whitespace-nowrap">
+                        <span className={`font-medium text-sm tracking-wide transition-colors duration-300 whitespace-nowrap ${isConfigActive ? 'text-signal-600 dark:text-white font-semibold' : 'text-slate-600 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300'}`}>
                             Settings
                         </span>
                     </div>
@@ -209,6 +215,8 @@
                         </div>
                     )}
                 </Link>
+                    );
+                })()}

                 {!isMobile && (
                     <button
INNER_EOF
patch -p0 < patch_sidebar.diff
