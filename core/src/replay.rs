use crate::error::{LinqaError, Result};
use std::collections::{HashSet, VecDeque};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

/// Durable backing store for a ReplayCache. Implementations must make
/// `append` visible to `load` even across a process restart (e.g. fsync'd
/// file writes), since the whole point of durability here is surviving a
/// crash or redeploy without resetting replay protection.
pub trait ReplayStorage: Send {
    fn load(&mut self) -> Result<Vec<String>>;
    fn append(&mut self, message_id: &str) -> Result<()>;
    /// Replace the entire durable log with exactly `retained`, in order.
    /// Called periodically to keep the on-disk log from growing without
    /// bound as old entries are evicted from the in-memory window.
    fn rewrite(&mut self, retained: &[String]) -> Result<()>;
}

/// Append-only, fsync'd, newline-delimited log file. Rebuilds the in-memory
/// set from this file on open, so replay protection survives a restart.
pub struct FileReplayStorage {
    path: PathBuf,
    file: File,
}

impl FileReplayStorage {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref().to_path_buf();
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)
            .map_err(|_| LinqaError::StorageFailure("could not open replay log file"))?;
        Ok(Self { path, file })
    }
}

impl ReplayStorage for FileReplayStorage {
    fn load(&mut self) -> Result<Vec<String>> {
        let file = File::open(&self.path)
            .map_err(|_| LinqaError::StorageFailure("could not read replay log file"))?;
        BufReader::new(file)
            .lines()
            .map(|line| {
                line.map_err(|_| LinqaError::StorageFailure("could not read replay log line"))
            })
            .filter(|line| !matches!(line, Ok(l) if l.is_empty()))
            .collect()
    }

    fn append(&mut self, message_id: &str) -> Result<()> {
        writeln!(self.file, "{message_id}")
            .map_err(|_| LinqaError::StorageFailure("could not append to replay log"))?;
        self.file
            .sync_data()
            .map_err(|_| LinqaError::StorageFailure("could not fsync replay log"))
    }

    fn rewrite(&mut self, retained: &[String]) -> Result<()> {
        let mut file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&self.path)
            .map_err(|_| LinqaError::StorageFailure("could not truncate replay log"))?;
        for id in retained {
            writeln!(file, "{id}")
                .map_err(|_| LinqaError::StorageFailure("could not rewrite replay log"))?;
        }
        file.sync_data()
            .map_err(|_| LinqaError::StorageFailure("could not fsync replay log"))?;

        self.file = OpenOptions::new()
            .append(true)
            .read(true)
            .open(&self.path)
            .map_err(|_| LinqaError::StorageFailure("could not reopen replay log for append"))?;
        Ok(())
    }
}

pub struct ReplayCache {
    capacity: usize,
    order: VecDeque<String>,
    seen: HashSet<String>,
    storage: Option<Box<dyn ReplayStorage>>,
    appends_since_compaction: usize,
}

impl ReplayCache {
    pub fn new(capacity: usize) -> Result<Self> {
        Self::with_storage(capacity, None)
    }

    /// Durable variant: replay state is loaded from `path` on open and every
    /// insert is fsync'd there, so a crash or restart does not reset replay
    /// protection.
    pub fn open_file(capacity: usize, path: impl AsRef<Path>) -> Result<Self> {
        let storage = FileReplayStorage::open(path)?;
        Self::with_storage(capacity, Some(Box::new(storage)))
    }

    fn with_storage(capacity: usize, mut storage: Option<Box<dyn ReplayStorage>>) -> Result<Self> {
        if capacity == 0 {
            return Err(LinqaError::InvalidInput(
                "replay cache capacity must be positive",
            ));
        }

        let mut order = VecDeque::new();
        let mut seen = HashSet::new();
        if let Some(store) = storage.as_mut() {
            let loaded = store.load()?;
            // Keep only the most recent `capacity` entries in memory; the
            // on-disk log itself is compacted to match on the next write.
            let start = loaded.len().saturating_sub(capacity);
            for id in &loaded[start..] {
                if seen.insert(id.clone()) {
                    order.push_back(id.clone());
                }
            }
        }

        Ok(Self {
            capacity,
            order,
            seen,
            storage,
            appends_since_compaction: 0,
        })
    }

    pub fn check_and_insert(&mut self, message_id: &str) -> Result<()> {
        if message_id.trim().is_empty() {
            return Err(LinqaError::InvalidInput("message ID is required"));
        }
        if self.seen.contains(message_id) {
            return Err(LinqaError::ReplayDetected);
        }

        if let Some(storage) = self.storage.as_mut() {
            storage.append(message_id)?;
        }

        self.seen.insert(message_id.to_owned());
        self.order.push_back(message_id.to_owned());

        while self.order.len() > self.capacity {
            if let Some(oldest) = self.order.pop_front() {
                self.seen.remove(&oldest);
            }
        }

        if self.storage.is_some() {
            self.appends_since_compaction += 1;
            if self.appends_since_compaction >= self.capacity {
                self.compact()?;
            }
        }

        Ok(())
    }

    fn compact(&mut self) -> Result<()> {
        if let Some(storage) = self.storage.as_mut() {
            let retained: Vec<String> = self.order.iter().cloned().collect();
            storage.rewrite(&retained)?;
        }
        self.appends_since_compaction = 0;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn in_memory_cache_rejects_a_repeated_id() {
        let mut cache = ReplayCache::new(10).unwrap();
        cache.check_and_insert("m1").unwrap();
        assert!(matches!(
            cache.check_and_insert("m1"),
            Err(LinqaError::ReplayDetected)
        ));
    }

    #[test]
    fn in_memory_cache_evicts_the_oldest_id_past_capacity() {
        let mut cache = ReplayCache::new(2).unwrap();
        cache.check_and_insert("m1").unwrap();
        cache.check_and_insert("m2").unwrap();
        cache.check_and_insert("m3").unwrap();
        // m1 was evicted to make room for m3, so it is accepted again.
        cache.check_and_insert("m1").unwrap();
    }

    #[test]
    fn replay_protection_survives_a_simulated_restart() {
        let dir = std::env::temp_dir().join(format!("linqa-replay-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("replay.log");
        let _ = std::fs::remove_file(&path);

        {
            let mut cache = ReplayCache::open_file(10, &path).unwrap();
            cache.check_and_insert("seen-before-restart").unwrap();
        }

        {
            let mut cache = ReplayCache::open_file(10, &path).unwrap();
            assert!(matches!(
                cache.check_and_insert("seen-before-restart"),
                Err(LinqaError::ReplayDetected)
            ));
            // A genuinely new ID is still accepted after reopening.
            cache.check_and_insert("new-after-restart").unwrap();
        }

        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }

    #[test]
    fn durable_log_is_compacted_and_still_correct_after_many_inserts() {
        let dir =
            std::env::temp_dir().join(format!("linqa-replay-compact-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("replay.log");
        let _ = std::fs::remove_file(&path);

        {
            let mut cache = ReplayCache::open_file(4, &path).unwrap();
            for i in 0..20 {
                cache.check_and_insert(&format!("m{i}")).unwrap();
            }
        }

        // Only the most recent `capacity` entries should still be tracked
        // as seen after reopening — older ones were legitimately evicted.
        {
            let mut cache = ReplayCache::open_file(4, &path).unwrap();
            assert!(matches!(
                cache.check_and_insert("m19"),
                Err(LinqaError::ReplayDetected)
            ));
            cache.check_and_insert("m0").unwrap();
        }

        std::fs::remove_file(&path).unwrap();
        std::fs::remove_dir(&dir).unwrap();
    }
}
