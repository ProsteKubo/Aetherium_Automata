#ifndef AETHERIUM_COMPAT_MUTEX_HPP
#define AETHERIUM_COMPAT_MUTEX_HPP

#if defined(AETHERIUM_PLATFORM_MCXN947)

namespace aeth::compat {

class Mutex {
public:
    void lock() noexcept {}
    void unlock() noexcept {}
    bool try_lock() noexcept { return true; }
};

template <typename MutexT>
class LockGuard {
public:
    explicit LockGuard(MutexT& mutex) noexcept : mutex_(mutex) {
        mutex_.lock();
    }

    ~LockGuard() {
        mutex_.unlock();
    }

    LockGuard(const LockGuard&) = delete;
    LockGuard& operator=(const LockGuard&) = delete;

private:
    MutexT& mutex_;
};

} // namespace aeth::compat

#else

#include <mutex>

namespace aeth::compat {

using Mutex = std::mutex;

template <typename MutexT = Mutex>
using LockGuard = std::lock_guard<MutexT>;

} // namespace aeth::compat

#endif

#endif // AETHERIUM_COMPAT_MUTEX_HPP
