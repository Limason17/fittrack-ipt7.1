import abCrunchMachine from '../assets/exercises/ab-crunch-machine.png'
import barbellCurl from '../assets/exercises/barbell-curl.png'
import barbellRow from '../assets/exercises/barbell-row.png'
import benchPress from '../assets/exercises/bench-press.png'
import crunch from '../assets/exercises/crunch.png'
import cycling from '../assets/exercises/cycling.png'
import inclineDumbbellPress from '../assets/exercises/incline-dumbbell-press.png'
import latPulldown from '../assets/exercises/lat-pulldown.png'
import lateralRaise from '../assets/exercises/lateral-raise.png'
import romanianDeadlift from '../assets/exercises/romanian-deadlift.png'
import shoulderPress from '../assets/exercises/shoulder-press.png'
import squat from '../assets/exercises/squat.png'
import standingCalfRaise from '../assets/exercises/standing-calf-raise.png'
import tricepsPushdown from '../assets/exercises/triceps-pushdown.png'

const exerciseImageMap = {
    'Bench Press': benchPress,
    'Incline Dumbbell Press': inclineDumbbellPress,
    'Lat Pulldown': latPulldown,
    'Barbell Row': barbellRow,
    'Squat': squat,
    'Romanian Deadlift': romanianDeadlift,
    'Standing Calf Raise': standingCalfRaise,
    'Shoulder Press': shoulderPress,
    'Lateral Raise': lateralRaise,
    'Barbell Curl': barbellCurl,
    'Triceps Pushdown': tricepsPushdown,
    'Crunch': crunch,
    'Bauchpresse': abCrunchMachine,
    'Cycling': cycling,
}

export function getExerciseImage(exerciseName) {
    return exerciseImageMap[exerciseName] || null
}