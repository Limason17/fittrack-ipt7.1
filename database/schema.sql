CREATE DATABASE IF NOT EXISTS fittrack;
USE fittrack;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(120) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exercises (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL, -- NULL = global exercise, otherwise created by user
  name VARCHAR(80) NOT NULL,
  description VARCHAR(255) NULL,
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
  sets INT,
  reps INT,
  weight DECIMAL(6,2),
  CONSTRAINT fk_workout_exercises_workout
    FOREIGN KEY (workout_id) REFERENCES workouts(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_workout_exercises_exercise
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);

CREATE TABLE IF NOT EXISTS progress_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  exercise_id INT NOT NULL,
  weight DECIMAL(6,2),
  reps INT,
  sets INT,
  entry_date DATE,
  CONSTRAINT fk_progress_user
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_progress_exercise
    FOREIGN KEY (exercise_id) REFERENCES exercises(id)
);
