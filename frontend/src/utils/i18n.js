import { ref } from 'vue'
import { apiRequest } from './api'
import { getToken, getUser, updateAuthUser } from './auth'
import { normalizeText } from './taxonomy'

const GUEST_LANGUAGE_KEY = 'fittrack_language_guest'
const USER_LANGUAGE_PREFIX = 'fittrack_language_user_'

function normalizeLanguage(language) {
    return language === 'en' ? 'en' : 'de'
}

function userLanguageKey(user) {
    return user?.id ? `${USER_LANGUAGE_PREFIX}${user.id}` : GUEST_LANGUAGE_KEY
}

function browserLanguage() {
    if (typeof navigator === 'undefined') {
        return 'de'
    }

    return navigator.language?.toLowerCase().startsWith('de') ? 'de' : 'en'
}

function initialLanguage() {
    const user = getUser()

    if (user?.language_preference) {
        return normalizeLanguage(user.language_preference)
    }

    const storedUserLanguage = user ? localStorage.getItem(userLanguageKey(user)) : null
    const storedGuestLanguage = localStorage.getItem(GUEST_LANGUAGE_KEY)

    return normalizeLanguage(storedUserLanguage || storedGuestLanguage || browserLanguage())
}

export const locale = ref(initialLanguage())

export const languages = [
    { code: 'de', label: 'DE', name: 'Deutsch' },
    { code: 'en', label: 'EN', name: 'English' },
]

export const messages = {
    de: {
        nav: {
            exercises: 'Übungen',
            workouts: 'Workouts',
            progress: 'Fortschritt',
            login: 'Login',
            register: 'Registrieren',
            logout: 'Logout',
            loggedIn: 'Angemeldet',
            languageTitle: 'Sprache wechseln',
            languageLabel: 'Aktuelle Sprache: Deutsch',
        },
        common: {
            add: 'Hinzufügen',
            cancel: 'Abbrechen',
            close: 'Schließen',
            delete: 'Löschen',
            edit: 'Bearbeiten',
            save: 'Speichern',
            saving: 'Speichern...',
            loading: 'Laden...',
            date: 'Datum',
            notes: 'Notizen',
            optional: 'Optional',
            sets: 'Sätze',
            reps: 'Wdh.',
            weight: 'Gewicht',
            kg: 'kg',
            duration: 'Dauer',
            minutesShort: 'min',
            distance: 'Distanz',
            km: 'km',
            level: 'Stufe',
            kmh: 'km/h',
            exercise: 'Übung',
            exercises: 'Übungen',
            requiredFields: 'Bitte fülle alle Pflichtfelder aus.',
            serverError: 'Server nicht erreichbar. Bitte versuche es erneut.',
            noSelection: 'Bitte auswählen',
        },
        home: {
            loggedInEyebrow: 'Dein Trainingsbereich',
            guestEyebrow: 'Einfaches Trainingstracking',
            loggedInTitle: 'Willkommen zurück, {username}.',
            guestTitle: 'FitTrack',
            loggedInSubtitle:
                'Verwalte Übungen, plane Workouts und sieh deinen Fortschritt an einem ruhigen, klaren Ort.',
            guestSubtitle:
                'Plane dein Training, speichere deine Übungen und verfolge deine Entwicklung in Deutsch oder Englisch.',
            start: 'Jetzt starten',
            login: 'Einloggen',
            workoutsCta: 'Workout planen',
            progressCta: 'Fortschritt ansehen',
            quickAccess: 'Schnellzugriff',
            quickQuestion: 'Was möchtest du heute machen?',
            personalArea: 'Persönlicher Bereich',
            loginRequired: 'Bitte zuerst einloggen',
            manage: 'Verwalten',
            open: 'Öffnen',
            view: 'Ansehen',
            features: [
                {
                    title: 'Übungen sammeln',
                    text: 'Lege eigene Übungen an und kombiniere sie mit den globalen Übungen aus dem Katalog.',
                },
                {
                    title: 'Workouts planen',
                    text: 'Speichere Kraftwerte oder Cardio-Daten mit Datum und Notizen.',
                },
                {
                    title: 'Fortschritt sehen',
                    text: 'Vergleiche deine letzten Einträge und erkenne deine besten Werte schneller.',
                },
            ],
        },
        auth: {
            loginTitle: 'Willkommen zurück.',
            loginSubtitle: 'Melde dich an, um deine Übungen, Workouts und Fortschritte zu sehen.',
            registerTitle: 'Erstelle dein Konto.',
            registerSubtitle:
                'Registriere dich, damit du deine persönlichen Trainingsdaten speichern kannst.',
            username: 'Benutzername',
            email: 'E-Mail',
            password: 'Passwort',
            passwordPlaceholder: 'Mindestens 6 Zeichen',
            loginButton: 'Login',
            loginLoading: 'Login läuft...',
            registerButton: 'Registrieren',
            registerLoading: 'Registrierung läuft...',
            noAccount: 'Noch kein Konto?',
            hasAccount: 'Schon registriert?',
            toRegister: 'Registrieren',
            toLogin: 'Zum Login',
            fillFields: 'Bitte fülle alle Felder aus.',
            passwordLength: 'Das Passwort muss mindestens 6 Zeichen lang sein.',
            loginFailed: 'Login fehlgeschlagen. Prüfe E-Mail und Passwort.',
            registerFailed: 'Registrierung fehlgeschlagen.',
            registerSuccess: 'Registrierung erfolgreich. Du kannst dich jetzt einloggen.',
        },
        exercises: {
            eyebrow: 'Übungen',
            title: 'Dein Übungskatalog',
            subtitle:
                'Filtere nach Kategorie und Muskelgruppe, erstelle eigene Übungen und nutze Bilder für eine schnelle Orientierung.',
            category: 'Kategorie',
            muscleGroup: 'Muskelgruppe',
            allCategories: 'Alle Kategorien',
            allMuscleGroups: 'Alle Muskelgruppen',
            resetFilters: 'Filter zurücksetzen',
            newExercise: 'Neue Übung',
            editExercise: 'Übung bearbeiten',
            createTitle: 'Eigene Übung erstellen',
            editTitle: 'Eigene Übung bearbeiten',
            name: 'Name',
            imageUrl: 'Bild-URL',
            description: 'Beschreibung',
            descriptionPlaceholder: 'Kurze Beschreibung der Übung',
            chooseCategory: 'Kategorie wählen',
            chooseMuscleGroup: 'Muskelgruppe wählen',
            saveExercise: 'Übung speichern',
            updateExercise: 'Änderungen speichern',
            created: 'Übung erfolgreich erstellt.',
            updated: 'Übung erfolgreich aktualisiert.',
            deleted: 'Übung erfolgreich gelöscht.',
            loadError: 'Übungen konnten nicht geladen werden.',
            saveError: 'Übung konnte nicht gespeichert werden.',
            deleteError: 'Übung konnte nicht gelöscht werden. Sie wird eventuell schon verwendet.',
            missingFields: 'Bitte fülle Name, Kategorie und Muskelgruppe aus.',
            loading: 'Übungen werden geladen...',
            empty: 'Keine Übungen gefunden. Passe die Filter an oder erstelle eine neue Übung.',
            noImage: 'Kein Bild vorhanden',
            custom: 'Eigene Übung',
            global: 'Globale Übung',
            noDescription: 'Keine Beschreibung vorhanden.',
            confirmDelete: 'Möchtest du "{name}" wirklich löschen?',
        },
        workouts: {
            eyebrow: 'Workouts',
            title: 'Deine Trainingspläne',
            subtitle:
                'Erstelle Workouts mit Datum, Übungen und Trainingsdaten. Gespeicherte Workouts landen automatisch im Fortschritt.',
            newWorkout: 'Workout erstellen',
            editWorkout: 'Workout bearbeiten',
            formCreateTitle: 'Neues Workout',
            formEditTitle: 'Workout bearbeiten',
            titleLabel: 'Titel',
            titlePlaceholder: 'z. B. Push Day',
            notesPlaceholder: 'Optional: Fokus, Gefühl oder kurze Planung',
            addExercise: 'Übung hinzufügen',
            chooseExercise: 'Übung auswählen',
            changeExercise: 'Übung ändern',
            selectedExercise: 'Ausgewählte Übung',
            exercisePickerTitle: 'Übung auswählen',
            exercisePickerSubtitle: 'Wähle eine Übung mit Bild aus oder filtere nach Kategorie und Muskelgruppe.',
            searchExercise: 'Übung suchen',
            noExerciseMatches: 'Keine passende Übung gefunden.',
            saveWorkout: 'Workout speichern',
            updateWorkout: 'Änderungen speichern',
            created: 'Workout erfolgreich erstellt.',
            updated: 'Workout erfolgreich aktualisiert.',
            deleted: 'Workout erfolgreich gelöscht.',
            loadError: 'Workouts konnten nicht geladen werden.',
            saveError: 'Workout konnte nicht gespeichert werden.',
            deleteError: 'Workout konnte nicht gelöscht werden.',
            missingFields:
                'Bitte gib Titel, Datum und mindestens eine vollständige Übung mit passenden Trainingsdaten ein.',
            calendar: 'Kalender',
            previousMonth: 'Vorheriger Monat',
            nextMonth: 'Nächster Monat',
            listTitle: 'Gespeicherte Workouts',
            noWorkouts: 'Noch keine Workouts gespeichert.',
            noWorkoutsText:
                'Erstelle dein erstes Workout, damit Trainingstage und Fortschritt sichtbar werden.',
            confirmDelete: 'Möchtest du "{title}" wirklich löschen?',
            total: '{count} Workouts',
        },
        progress: {
            eyebrow: 'Fortschritt',
            title: 'Deine Entwicklung',
            subtitle:
                'Alle Workout-Daten und manuellen Einträge werden hier zusammengeführt, damit du Bestwerte und letzte Trainings siehst.',
            addEntry: 'Eintrag hinzufügen',
            formTitle: 'Manuellen Fortschritt erfassen',
            entryDate: 'Eintragsdatum',
            saveEntry: 'Eintrag speichern',
            saved: 'Fortschrittseintrag gespeichert.',
            deleted: 'Fortschrittseintrag gelöscht.',
            loadError: 'Fortschritt konnte nicht geladen werden.',
            exerciseLoadError: '\u00dcbungen konnten nicht geladen werden.',
            saveError: 'Eintrag konnte nicht gespeichert werden.',
            deleteError: 'Eintrag konnte nicht gelöscht werden.',
            missingFields:
                'Bitte wähle eine Übung und gib Datum sowie passende Trainingsdaten ein.',
            noExercisesAvailable: 'Keine \u00dcbungen verf\u00fcgbar.',
            chartTitle: 'Fortschritt pro \u00dcbung',
            chartSubtitle:
                'Die Linie zeigt die letzten Eintr\u00e4ge pro \u00dcbung und macht deine Entwicklung sichtbar.',
            noChartData: 'Noch keine Chart-Daten vorhanden.',
            startValue: 'Start',
            currentValue: 'Aktuell',
            summaryTitle: 'Bestwerte',
            latestEntries: 'Letzte Einträge',
            noSummary: 'Noch keine Fortschrittsdaten vorhanden.',
            noEntries:
                'Speichere ein Workout oder erfasse einen manuellen Eintrag, um Fortschritt zu sehen.',
            maxWeight: 'Bestes Gewicht',
            maxVolume: 'Bestes Volumen',
            maxDuration: 'Längste Dauer',
            maxDistance: 'Beste Distanz',
            maxSpeed: 'Bestes Tempo',
            estimatedOneRepMax: 'Geschätztes 1RM',
            totalReps: 'Gesamtwiederholungen',
            latest: 'Zuletzt',
            entries: 'Einträge',
            manualEntry: 'Manueller Eintrag',
            source: 'Quelle',
            confirmDelete: 'Möchtest du diesen Fortschrittseintrag wirklich löschen?',
        },
        taxonomy: {
            categories: {
                Brust: 'Brust',
                Rücken: 'Rücken',
                Beine: 'Beine',
                Schultern: 'Schultern',
                Arme: 'Arme',
                Core: 'Core',
                Cardio: 'Cardio',
            },
            muscleGroups: {
                Brustmitte: 'Brustmitte',
                'Obere Brust': 'Obere Brust',
                Latissimus: 'Latissimus',
                'Oberer Rücken': 'Oberer Rücken',
                Quads: 'Quads',
                Hamstrings: 'Hamstrings',
                Waden: 'Waden',
                'Vordere Schulter': 'Vordere Schulter',
                'Seitliche Schulter': 'Seitliche Schulter',
                Bizeps: 'Bizeps',
                Trizeps: 'Trizeps',
                Bauch: 'Bauch',
                Core: 'Core',
                Ganzkörper: 'Ganzkörper',
                Beine: 'Beine',
            },
        },
        exerciseDescriptions: {
            'Bench Press': 'Klassische Druckübung für die Brust.',
            'Incline Dumbbell Press': 'Schrägbank mit Kurzhanteln für die obere Brust.',
            'Lat Pulldown': 'Zugübung für den Rücken und besonders den Latissimus.',
            'Barbell Row': 'Ruderübung für den oberen Rücken.',
            Squat: 'Grundübung für Beine und Rumpf.',
            'Romanian Deadlift': 'Beinrückseite und Gesäss.',
            'Standing Calf Raise': 'Übung für die Waden.',
            'Shoulder Press': 'Druckübung für die Schultern.',
            'Lateral Raise': 'Isolation für die seitliche Schulter.',
            'Barbell Curl': 'Klassische Bizepsübung.',
            'Triceps Pushdown': 'Isolation für den Trizeps.',
            Crunch: 'Bauchübung für die Körpermitte.',
            Bauchpresse: 'Maschinenübung für die Bauchmuskulatur.',
            Cycling: 'Cardio auf dem Fahrrad oder Ergometer.',
        },
    },
    en: {
        nav: {
            exercises: 'Exercises',
            workouts: 'Workouts',
            progress: 'Progress',
            login: 'Login',
            register: 'Register',
            logout: 'Logout',
            loggedIn: 'Signed in',
            languageTitle: 'Switch language',
            languageLabel: 'Current language: English',
        },
        common: {
            add: 'Add',
            cancel: 'Cancel',
            close: 'Close',
            delete: 'Delete',
            edit: 'Edit',
            save: 'Save',
            saving: 'Saving...',
            loading: 'Loading...',
            date: 'Date',
            notes: 'Notes',
            optional: 'Optional',
            sets: 'Sets',
            reps: 'Reps',
            weight: 'Weight',
            kg: 'kg',
            duration: 'Duration',
            minutesShort: 'min',
            distance: 'Distance',
            km: 'km',
            level: 'Level',
            kmh: 'km/h',
            exercise: 'Exercise',
            exercises: 'Exercises',
            requiredFields: 'Please complete all required fields.',
            serverError: 'Server unavailable. Please try again.',
            noSelection: 'Please choose',
        },
        home: {
            loggedInEyebrow: 'Your training space',
            guestEyebrow: 'Simple workout tracking',
            loggedInTitle: 'Welcome back, {username}.',
            guestTitle: 'FitTrack',
            loggedInSubtitle:
                'Manage exercises, plan workouts and review your progress in one calm, clear place.',
            guestSubtitle:
                'Plan your training, save exercises and track your development in German or English.',
            start: 'Get started',
            login: 'Login',
            workoutsCta: 'Plan workout',
            progressCta: 'View progress',
            quickAccess: 'Quick access',
            quickQuestion: 'What would you like to do today?',
            personalArea: 'Personal area',
            loginRequired: 'Please log in first',
            manage: 'Manage',
            open: 'Open',
            view: 'View',
            features: [
                {
                    title: 'Collect exercises',
                    text: 'Create your own exercises and combine them with the global exercise catalog.',
                },
                {
                    title: 'Plan workouts',
                    text: 'Save strength values or cardio data with dates and useful notes.',
                },
                {
                    title: 'See progress',
                    text: 'Compare your latest entries and spot personal bests faster.',
                },
            ],
        },
        auth: {
            loginTitle: 'Welcome back.',
            loginSubtitle: 'Sign in to see your exercises, workouts and progress.',
            registerTitle: 'Create your account.',
            registerSubtitle: 'Register so your personal training data can be saved.',
            username: 'Username',
            email: 'Email',
            password: 'Password',
            passwordPlaceholder: 'At least 6 characters',
            loginButton: 'Login',
            loginLoading: 'Logging in...',
            registerButton: 'Register',
            registerLoading: 'Registering...',
            noAccount: 'No account yet?',
            hasAccount: 'Already registered?',
            toRegister: 'Register',
            toLogin: 'Go to login',
            fillFields: 'Please fill in all fields.',
            passwordLength: 'The password must be at least 6 characters long.',
            loginFailed: 'Login failed. Check your email and password.',
            registerFailed: 'Registration failed.',
            registerSuccess: 'Registration successful. You can now log in.',
        },
        exercises: {
            eyebrow: 'Exercises',
            title: 'Your exercise catalog',
            subtitle:
                'Filter by category and muscle group, create your own exercises and use images for quick orientation.',
            category: 'Category',
            muscleGroup: 'Muscle group',
            allCategories: 'All categories',
            allMuscleGroups: 'All muscle groups',
            resetFilters: 'Reset filters',
            newExercise: 'New exercise',
            editExercise: 'Edit exercise',
            createTitle: 'Create custom exercise',
            editTitle: 'Edit custom exercise',
            name: 'Name',
            imageUrl: 'Image URL',
            description: 'Description',
            descriptionPlaceholder: 'Short exercise description',
            chooseCategory: 'Choose category',
            chooseMuscleGroup: 'Choose muscle group',
            saveExercise: 'Save exercise',
            updateExercise: 'Save changes',
            created: 'Exercise created successfully.',
            updated: 'Exercise updated successfully.',
            deleted: 'Exercise deleted successfully.',
            loadError: 'Exercises could not be loaded.',
            saveError: 'Exercise could not be saved.',
            deleteError: 'Exercise could not be deleted. It may already be used.',
            missingFields: 'Please fill in name, category and muscle group.',
            loading: 'Loading exercises...',
            empty: 'No exercises found. Adjust the filters or create a new exercise.',
            noImage: 'No image available',
            custom: 'Custom exercise',
            global: 'Global exercise',
            noDescription: 'No description available.',
            confirmDelete: 'Do you really want to delete "{name}"?',
        },
        workouts: {
            eyebrow: 'Workouts',
            title: 'Your training plans',
            subtitle:
                'Create workouts with dates, exercises and training data. Saved workouts automatically appear in progress.',
            newWorkout: 'Create workout',
            editWorkout: 'Edit workout',
            formCreateTitle: 'New workout',
            formEditTitle: 'Edit workout',
            titleLabel: 'Title',
            titlePlaceholder: 'e.g. Push day',
            notesPlaceholder: 'Optional: focus, feeling or short plan',
            addExercise: 'Add exercise',
            chooseExercise: 'Choose exercise',
            changeExercise: 'Change exercise',
            selectedExercise: 'Selected exercise',
            exercisePickerTitle: 'Choose exercise',
            exercisePickerSubtitle: 'Select an exercise with an image or filter by category and muscle group.',
            searchExercise: 'Search exercise',
            noExerciseMatches: 'No matching exercise found.',
            saveWorkout: 'Save workout',
            updateWorkout: 'Save changes',
            created: 'Workout created successfully.',
            updated: 'Workout updated successfully.',
            deleted: 'Workout deleted successfully.',
            loadError: 'Workouts could not be loaded.',
            saveError: 'Workout could not be saved.',
            deleteError: 'Workout could not be deleted.',
            missingFields:
                'Please enter a title, date and at least one complete exercise with matching training data.',
            calendar: 'Calendar',
            previousMonth: 'Previous month',
            nextMonth: 'Next month',
            listTitle: 'Saved workouts',
            noWorkouts: 'No workouts saved yet.',
            noWorkoutsText: 'Create your first workout so training days and progress become visible.',
            confirmDelete: 'Do you really want to delete "{title}"?',
            total: '{count} workouts',
        },
        progress: {
            eyebrow: 'Progress',
            title: 'Your development',
            subtitle:
                'Workout data and manual entries are combined here so you can see personal bests and recent sessions.',
            addEntry: 'Add entry',
            formTitle: 'Add manual progress',
            entryDate: 'Entry date',
            saveEntry: 'Save entry',
            saved: 'Progress entry saved.',
            deleted: 'Progress entry deleted.',
            loadError: 'Progress could not be loaded.',
            exerciseLoadError: 'Exercises could not be loaded.',
            saveError: 'Entry could not be saved.',
            deleteError: 'Entry could not be deleted.',
            missingFields: 'Please choose an exercise and enter date plus matching training data.',
            noExercisesAvailable: 'No exercises available.',
            chartTitle: 'Progress per exercise',
            chartSubtitle:
                'The line shows the latest entries per exercise so your development is easier to read.',
            noChartData: 'No chart data yet.',
            startValue: 'Start',
            currentValue: 'Current',
            summaryTitle: 'Personal bests',
            latestEntries: 'Latest entries',
            noSummary: 'No progress data yet.',
            noEntries: 'Save a workout or add a manual entry to see progress.',
            maxWeight: 'Best weight',
            maxVolume: 'Best volume',
            maxDuration: 'Longest duration',
            maxDistance: 'Best distance',
            maxSpeed: 'Best speed',
            estimatedOneRepMax: 'Estimated 1RM',
            totalReps: 'Total reps',
            latest: 'Latest',
            entries: 'Entries',
            manualEntry: 'Manual entry',
            source: 'Source',
            confirmDelete: 'Do you really want to delete this progress entry?',
        },
        taxonomy: {
            categories: {
                Brust: 'Chest',
                Rücken: 'Back',
                Beine: 'Legs',
                Schultern: 'Shoulders',
                Arme: 'Arms',
                Core: 'Core',
                Cardio: 'Cardio',
            },
            muscleGroups: {
                Brustmitte: 'Mid chest',
                'Obere Brust': 'Upper chest',
                Latissimus: 'Latissimus',
                'Oberer Rücken': 'Upper back',
                Quads: 'Quads',
                Hamstrings: 'Hamstrings',
                Waden: 'Calves',
                'Vordere Schulter': 'Front delts',
                'Seitliche Schulter': 'Side delts',
                Bizeps: 'Biceps',
                Trizeps: 'Triceps',
                Bauch: 'Abs',
                Core: 'Core',
                Ganzkörper: 'Full body',
                Beine: 'Legs',
            },
        },
        exerciseDescriptions: {
            'Bench Press': 'Classic pressing movement for the chest.',
            'Incline Dumbbell Press': 'Incline dumbbell press for the upper chest.',
            'Lat Pulldown': 'Pulling movement for the back, especially the lats.',
            'Barbell Row': 'Rowing movement for the upper back.',
            Squat: 'Foundational movement for legs and trunk.',
            'Romanian Deadlift': 'Posterior chain movement for hamstrings and glutes.',
            'Standing Calf Raise': 'Exercise for the calves.',
            'Shoulder Press': 'Pressing movement for the shoulders.',
            'Lateral Raise': 'Isolation movement for the side delts.',
            'Barbell Curl': 'Classic biceps exercise.',
            'Triceps Pushdown': 'Isolation movement for the triceps.',
            Crunch: 'Ab exercise for the midsection.',
            Bauchpresse: 'Machine exercise for the abdominal muscles.',
            Cycling: 'Cardio on a bike or ergometer.',
        },
    },
}

function resolveMessage(language, key) {
    return key.split('.').reduce((value, part) => value?.[part], messages[language])
}

function interpolate(value, params) {
    return value.replace(/\{(\w+)\}/g, (_, key) => params[key] ?? '')
}

export function t(key, params = {}) {
    const value = resolveMessage(locale.value, key) ?? resolveMessage('de', key)

    if (typeof value === 'string') {
        return interpolate(value, params)
    }

    return value ?? key
}

export function translateCategory(value) {
    const normalizedValue = normalizeText(value)
    return resolveMessage(locale.value, `taxonomy.categories.${normalizedValue}`) || normalizedValue
}

export function translateMuscleGroup(value) {
    const normalizedValue = normalizeText(value)
    return resolveMessage(locale.value, `taxonomy.muscleGroups.${normalizedValue}`) || normalizedValue
}

export function translateExerciseDescription(exercise) {
    const description = normalizeText(exercise.description)

    return (
        resolveMessage(locale.value, `exerciseDescriptions.${exercise.name}`) ||
        description ||
        t('exercises.noDescription')
    )
}

function persistLanguage(language) {
    const user = getUser()
    localStorage.setItem(userLanguageKey(user), language)

    if (!user) {
        localStorage.setItem(GUEST_LANGUAGE_KEY, language)
    }
}

function syncDocumentLanguage(language) {
    if (typeof document !== 'undefined') {
        document.documentElement.lang = language
    }
}

export async function setLanguage(language, options = {}) {
    const nextLanguage = normalizeLanguage(language)
    const { saveRemote = true } = options

    locale.value = nextLanguage
    persistLanguage(nextLanguage)
    syncDocumentLanguage(nextLanguage)

    const user = getUser()
    const token = getToken()

    if (user) {
        updateAuthUser({ language_preference: nextLanguage })
    }

    if (saveRemote && user && token) {
        try {
            await apiRequest('/users/language', {
                method: 'PUT',
                token,
                body: { language_preference: nextLanguage },
            })
        } catch (error) {
            console.warn('Could not save language preference', error)
        }
    }
}

export function toggleLanguage() {
    return setLanguage(locale.value === 'de' ? 'en' : 'de')
}

export function applyLanguageForUser(user) {
    const preferredLanguage = normalizeLanguage(
        user?.language_preference || localStorage.getItem(userLanguageKey(user)) || locale.value
    )

    return setLanguage(preferredLanguage, { saveRemote: false })
}

export function formatDate(value, options = { day: '2-digit', month: 'short', year: 'numeric' }) {
    if (!value) {
        return ''
    }

    const date = typeof value === 'string' ? new Date(`${value}T00:00:00`) : new Date(value)

    if (Number.isNaN(date.getTime())) {
        return ''
    }

    return new Intl.DateTimeFormat(locale.value === 'de' ? 'de-CH' : 'en-US', options).format(date)
}

export function weekdayNames(format = 'short') {
    const baseMonday = new Date('2024-01-01T00:00:00')

    return Array.from({ length: 7 }, (_, index) => {
        const date = new Date(baseMonday)
        date.setDate(baseMonday.getDate() + index)

        return new Intl.DateTimeFormat(locale.value === 'de' ? 'de-CH' : 'en-US', {
            weekday: format,
        }).format(date)
    })
}

syncDocumentLanguage(locale.value)
