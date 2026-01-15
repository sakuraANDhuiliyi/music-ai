import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Studio from '../views/Studio.vue'
import Explore from '../views/Explore.vue'
import ProjectDetail from '../views/ProjectDetail.vue'
import Library from '../views/Library.vue'
import Search from '../views/Search.vue'
import Auth from '../views/Auth.vue'
import Profile from '../views/Profile.vue'
import Notification from '../views/Notifications.vue'
import Admin from '../views/Admin.vue'
import AudioToSheet from '../views/AudioToSheet.vue'
import PianoPlay from '../views/PianoPlay.vue'
import AiChordCreator from '../views/AiChordCreator.vue'
import DailyRecommendations from '../views/DailyRecommendations.vue'
import Feed from '../views/Feed.vue'
import UserSpace from '../views/UserSpace.vue'
import PostDetail from '../views/PostDetail.vue'
import { useLoader } from '../composables/useLoader.js'
const routes = [
    { path: '/', name: 'Home', component: Home },
    { path: '/studio/:projectId?', name: 'Studio', component: Studio },
    { path: '/explore', name: 'Explore', component: Explore, meta: { keepAlive: true } },
    { path: '/daily', name: 'DailyRecommendations', component: DailyRecommendations },
    { path: '/feed', name: 'Feed', component: Feed, meta: { keepAlive: true } },
    { path: '/u/:id', name: 'UserSpace', component: UserSpace },
    { path: '/projects/:id', name: 'ProjectDetail', component: ProjectDetail },
    { path: '/posts/:id', name: 'PostDetail', component: PostDetail },
    { path: '/library', name: 'Library', component: Library, meta: { keepAlive: true } },
    { path: '/ai-chord', name: 'AiChordCreator', component: AiChordCreator },
    { path: '/search', name: 'Search', component: Search, meta: { keepAlive: true } },
    { path: '/audio-to-sheet', name: 'AudioToSheet', component: AudioToSheet },
    { path: '/piano', name: 'PianoPlay', component: PianoPlay },
    { path: '/login', name: 'Login', component: Auth, props: { initialType: 'login' } },
    { path: '/register', name: 'Register', component: Auth, props: { initialType: 'register' } },
    { path: '/profile', name: 'Profile', component: Profile },
    { path: '/notifications', name: 'Notifications', component: Notification },
    { path: '/admin', name: 'Admin', component: Admin },
]

const scrollPositions = new Map()

const router = createRouter({
    history: createWebHistory(),
    routes,
    scrollBehavior(to, from, savedPosition) {
        if (savedPosition) return savedPosition
        const pos = scrollPositions.get(to.fullPath)
        if (to.meta?.keepAlive && pos) return pos
        return { left: 0, top: 0 }
    },
})

// Route-level loading overlay (avoid flicker with a small delay)
const { showLoading, hideLoading } = useLoader()
let loadingTimer = null

router.beforeEach((to, from, next) => {
    try {
        if (from?.fullPath) {
            scrollPositions.set(from.fullPath, { left: window.scrollX || 0, top: window.scrollY || 0 })
        }
    } catch {
        // ignore
    }
    if (loadingTimer) clearTimeout(loadingTimer)
    loadingTimer = setTimeout(() => showLoading(), 120)
    next()
})

router.afterEach(() => {
    if (loadingTimer) {
        clearTimeout(loadingTimer)
        loadingTimer = null
    }
    hideLoading()
})

router.onError(() => {
    if (loadingTimer) {
        clearTimeout(loadingTimer)
        loadingTimer = null
    }
    hideLoading()
})

export default router
