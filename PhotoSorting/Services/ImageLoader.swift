import Foundation
import ImageIO
import Photos
import UIKit

/// Async wrappers around `PHImageManager.requestImage`.
enum ImageLoader {
    /// Shared manager for grid thumbnails and detail images.
    static let displayManager = PHCachingImageManager()

    /// Loads an image for `asset`. Returns nil on error, cancellation or Task cancellation.
    /// Degraded (placeholder) results are ignored; the continuation resumes exactly once.
    static func image(
        for asset: PHAsset,
        targetSize: CGSize,
        contentMode: PHImageContentMode = .aspectFit,
        deliveryMode: PHImageRequestOptionsDeliveryMode = .highQualityFormat,
        manager: PHImageManager = PHImageManager.default()
    ) async -> UIImage? {
        if Task.isCancelled { return nil }

        let options = PHImageRequestOptions()
        options.deliveryMode = deliveryMode
        options.isNetworkAccessAllowed = true
        options.resizeMode = .fast
        options.isSynchronous = false

        let state = ImageRequestState(manager: manager)
        return await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<UIImage?, Never>) in
                guard state.start(continuation) else { return }
                let requestID = manager.requestImage(
                    for: asset,
                    targetSize: targetSize,
                    contentMode: contentMode,
                    options: options
                ) { image, info in
                    let isCancelled = (info?[PHImageCancelledKey] as? Bool) ?? false
                    let error = info?[PHImageErrorKey] as? Error
                    if isCancelled || error != nil {
                        state.finish(nil)
                        return
                    }
                    let isDegraded = (info?[PHImageResultIsDegradedKey] as? Bool) ?? false
                    if isDegraded { return }
                    state.finish(image)
                }
                state.setRequestID(requestID)
            }
        } onCancel: {
            state.cancel()
        }
    }
}

/// Guards a single image request so its continuation is resumed exactly once,
/// whichever comes first: the final result, an error, or Task cancellation.
private final class ImageRequestState: @unchecked Sendable {
    private let lock = NSLock()
    private let manager: PHImageManager
    private var continuation: CheckedContinuation<UIImage?, Never>?
    private var requestID: PHImageRequestID?
    private var isCancelled = false

    init(manager: PHImageManager) {
        self.manager = manager
    }

    /// Stores the continuation. Returns false (after resuming with nil) if already cancelled.
    func start(_ continuation: CheckedContinuation<UIImage?, Never>) -> Bool {
        lock.lock()
        if isCancelled {
            lock.unlock()
            continuation.resume(returning: nil)
            return false
        }
        self.continuation = continuation
        lock.unlock()
        return true
    }

    func setRequestID(_ id: PHImageRequestID) {
        lock.lock()
        requestID = id
        let cancelled = isCancelled
        lock.unlock()
        if cancelled {
            manager.cancelImageRequest(id)
        }
    }

    func finish(_ image: UIImage?) {
        lock.lock()
        let pending = continuation
        continuation = nil
        lock.unlock()
        pending?.resume(returning: image)
    }

    func cancel() {
        lock.lock()
        isCancelled = true
        let pending = continuation
        continuation = nil
        let id = requestID
        lock.unlock()
        if let id {
            manager.cancelImageRequest(id)
        }
        pending?.resume(returning: nil)
    }
}

extension CGImagePropertyOrientation {
    init(uiOrientation: UIImage.Orientation) {
        switch uiOrientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
