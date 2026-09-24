// Apple Health, read-only: the body measurements the meal targets start from.
//
// One command. `read_body` asks for read access to six types (the system shows
// its sheet only the first time; after that the call returns at once), then
// reads what it was given. HealthKit never says whether a read was denied — a
// denied type simply has no samples — so "denied" and "never measured" arrive
// here as the same empty answer, which is all the caller needs.
//
// The raw samples go back unreduced: the 7-day mean, the lean-mass fallback and
// the age are computed in src/platform/app/health.ts, where they are tested.
// Nothing is ever written to HealthKit.

import Foundation
import HealthKit
import Tauri

/// One measurement. `day` is the calendar day of the sample's end in the
/// device's time zone, `at` the same instant in epoch milliseconds.
struct BodySample: Encodable {
    let value: Double
    let day: String
    let at: Double
}

struct BirthDate: Encodable {
    let year: Int
    let month: Int
    let day: Int
}

/// What crosses to the webview. Property names are what Rust passes through
/// and TypeScript reads; nil properties are left out.
struct BodyPayload: Encodable {
    /// False where the device has no Health store; everything else is then empty.
    var available: Bool
    /// Centimetres, the latest ever recorded.
    var height: BodySample?
    /// Kilograms, the last 30 days, newest first.
    var mass: [BodySample] = []
    /// A fraction (0.25 is 25 %), the latest within 30 days.
    var bodyFat: BodySample?
    /// Kilograms, the last 30 days, newest first.
    var leanMass: [BodySample] = []
    /// Centimetres, the latest within 30 days.
    var waist: BodySample?
    /// "m" or "f"; nil for other, not set, or not allowed.
    var sex: String?
    var birth: BirthDate?
}

class HealthPlugin: Plugin {
    private let store = HKHealthStore()

    @objc(read_body:)
    public func readBody(_ invoke: Invoke) {
        guard HKHealthStore.isHealthDataAvailable() else {
            invoke.resolve(BodyPayload(available: false))
            return
        }
        Task {
            do {
                try await self.store.requestAuthorization(toShare: [], read: HealthPlugin.readTypes)
            } catch {
                invoke.reject("Apple Health did not grant access: \(error.localizedDescription)")
                return
            }
            invoke.resolve(await self.read())
        }
    }

    private static let heightType = HKQuantityType(.height)
    private static let massType = HKQuantityType(.bodyMass)
    private static let bodyFatType = HKQuantityType(.bodyFatPercentage)
    private static let leanMassType = HKQuantityType(.leanBodyMass)
    private static let waistType = HKQuantityType(.waistCircumference)

    private static let readTypes: Set<HKObjectType> = [
        heightType, massType, bodyFatType, leanMassType, waistType,
        HKCharacteristicType(.biologicalSex),
        HKCharacteristicType(.dateOfBirth),
    ]

    private func read() async -> BodyPayload {
        let monthAgo = Date().addingTimeInterval(-30 * 24 * 3600)
        let cm = HKUnit.meterUnit(with: .centi)
        let kg = HKUnit.gramUnit(with: .kilo)

        var body = BodyPayload(available: true)
        body.height = await samples(HealthPlugin.heightType, cm, since: nil, limit: 1).first
        body.mass = await samples(HealthPlugin.massType, kg, since: monthAgo, limit: nil)
        body.bodyFat = await samples(HealthPlugin.bodyFatType, .percent(), since: monthAgo, limit: 1).first
        body.leanMass = await samples(HealthPlugin.leanMassType, kg, since: monthAgo, limit: nil)
        body.waist = await samples(HealthPlugin.waistType, cm, since: monthAgo, limit: 1).first

        switch (try? store.biologicalSex())?.biologicalSex {
        case .male: body.sex = "m"
        case .female: body.sex = "f"
        default: body.sex = nil
        }
        if let dob = try? store.dateOfBirthComponents(),
           let year = dob.year, let month = dob.month, let day = dob.day {
            body.birth = BirthDate(year: year, month: month, day: day)
        }
        return body
    }

    /// Newest first. An error reads as no samples: HealthKit reports a denied
    /// type as empty anyway, and the caller treats both the same.
    private func samples(
        _ type: HKQuantityType, _ unit: HKUnit, since: Date?, limit: Int?
    ) async -> [BodySample] {
        let predicate = since.map {
            HKQuery.predicateForSamples(withStart: $0, end: nil, options: .strictEndDate)
        }
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.quantitySample(type: type, predicate: predicate)],
            sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)],
            limit: limit
        )
        guard let found = try? await descriptor.result(for: store) else { return [] }
        return found.map {
            BodySample(
                value: $0.quantity.doubleValue(for: unit),
                day: HealthPlugin.dayString($0.endDate),
                at: ($0.endDate.timeIntervalSince1970 * 1000).rounded()
            )
        }
    }

    private static func dayString(_ date: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

@_cdecl("init_plugin_health")
func initPlugin() -> Plugin {
    return HealthPlugin()
}
