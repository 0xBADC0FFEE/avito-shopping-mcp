export const SEARCH_SORTS = ["default", "price", "price_desc", "date", "discount"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export interface Location {
  id: number;
  name: string;
}

export interface SearchSeller {
  name: string;
  url: string | null;
  rating: number | null;
}

export interface SearchItem {
  id: number;
  title: string;
  price: number | null;
  priceText: string | null;
  url: string;
  location: string | null;
  publishedAt: string | null;
  image: string | null;
  seller: SearchSeller | null;
}

export interface SearchResult {
  query: string;
  location: Location;
  sort: SearchSort;
  page: number;
  totalCount: number;
  count: number;
  items: SearchItem[];
}

export interface Characteristic {
  name: string;
  value: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ItemViews {
  total: number | null;
  today: number | null;
}

export interface SellerRatingBadge {
  score: number | null;
  summary: string | null;
}

export interface ItemSeller {
  name: string;
  isCompany: boolean;
  type: string | null;
  replyTimeText: string | null;
  tenureSince: string | null;
  rating: SellerRatingBadge | null;
  url: string | null;
}

export interface ItemDetails {
  id: number;
  title: string;
  url: string;
  active: boolean | null;
  price: number | null;
  priceText: string | null;
  description: string | null;
  characteristics: Characteristic[];
  address: string | null;
  coords: Coordinates | null;
  images: string[];
  publishedText: string | null;
  views: ItemViews | null;
  seller: ItemSeller | null;
}

export interface ScoreCount {
  score: number;
  count: number;
}

export interface RatingSummary {
  score: number | null;
  reviewCount: number | null;
  distribution: ScoreCount[];
}

export interface SellerReview {
  score: number | null;
  date: string | null;
  role: string | null;
  itemTitle: string | null;
  stage: string | null;
  text: string;
  answer: string | null;
}

export interface SellerReviewsResult {
  listing: { id: number; title: string; url: string };
  seller: ItemSeller | null;
  rating: RatingSummary | null;
  count: number;
  reviews: SellerReview[];
}
