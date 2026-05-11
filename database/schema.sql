CREATE DATABASE IF NOT EXISTS fittrack;
USE fittrack;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS progress_entries;
DROP TABLE IF EXISTS workout_exercises;
DROP TABLE IF EXISTS workouts;
DROP TABLE IF EXISTS exercises;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    language_preference ENUM('de', 'en') NOT NULL DEFAULT 'de',
    weight_unit ENUM('kg', 'lb') NOT NULL DEFAULT 'kg',
    distance_unit ENUM('km', 'mi') NOT NULL DEFAULT 'km',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exercises (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(255) NULL,
    category VARCHAR(50) NOT NULL,
    muscle_group VARCHAR(50) NOT NULL,
    image_url VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_exercises_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workouts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(100) NOT NULL,
    workout_date DATE NOT NULL,
    notes VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_workouts_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS workout_exercises (
    id INT AUTO_INCREMENT PRIMARY KEY,
    workout_id INT NOT NULL,
    exercise_id INT NOT NULL,
    sets INT NULL,
    reps INT NULL,
    weight DECIMAL(6,2) NULL,
    duration_minutes INT NULL,
    distance_km DECIMAL(7,2) NULL,
    intensity_level INT NULL,
    CONSTRAINT fk_workout_exercises_workout
    FOREIGN KEY (workout_id) REFERENCES workouts(id)
    ON DELETE CASCADE,
    CONSTRAINT fk_workout_exercises_exercise
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);

CREATE TABLE IF NOT EXISTS progress_entries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    workout_id INT NULL,
    exercise_id INT NOT NULL,
    weight DECIMAL(6,2) NULL,
    reps INT NULL,
    sets INT NULL,
    duration_minutes INT NULL,
    distance_km DECIMAL(7,2) NULL,
    intensity_level INT NULL,
    entry_date DATE NOT NULL,
    CONSTRAINT fk_progress_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
    CONSTRAINT fk_progress_workout
    FOREIGN KEY (workout_id) REFERENCES workouts(id)
    ON DELETE CASCADE,
    CONSTRAINT fk_progress_exercise
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);

CREATE INDEX idx_exercises_user ON exercises(user_id);
CREATE INDEX idx_workouts_user_date ON workouts(user_id, workout_date);
CREATE INDEX idx_progress_user_date ON progress_entries(user_id, entry_date);
